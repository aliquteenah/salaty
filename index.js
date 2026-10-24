import express from 'express';
import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pino from 'pino';
import fetch from 'node-fetch';

import { restoreSubscribersFromFirebase, saveSubscribersToFirebase, restoreAuthFromFirebase, saveAuthToFirebase } from './config/firebase.js';
import { getFormattedDate } from './utils/helpers.js';
import { quranTimers, sequentialQuranProgress, handleQuranCommands } from './features/quran.js';
import { handleHadithCommands, getRandomHadith } from './features/hadith.js';
import { getPlace, getPrayerTimings, formatTimingsSchedule, startPrayerCheckLoop } from './features/prayer.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => res.send('🕌 البوت الشامل يعمل بنجاح  بـ!'));
app.listen(PORT, '0.0.0.0', () => console.log(`✅ خادم الويب يعمل على المنفذ: ${PORT}`));

const RENDER_URL = process.env.RENDER_EXTERNAL_URL;
if (RENDER_URL) {
    setInterval(() => { fetch(RENDER_URL).catch(() => {}); }, 5 * 60 * 1000);
}

let subscribers = {};
let hadithSubscribers = {};
const PHONE_NUMBER = "966551138192";

async function startBot() {
    await restoreAuthFromFirebase();
    const subData = await restoreSubscribersFromFirebase();
    subscribers = subData.subscribers;
    hadithSubscribers = subData.hadithSubscribers;

    const { version } = await fetchLatestBaileysVersion();
    const { state, saveCreds } = await useMultiFileAuthState('prayer_bot_auth');

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        syncFullHistory: false,
        markOnlineOnConnect: true
    });

    sock.ev.on('creds.update', async () => {
        await saveCreds();
        await saveAuthToFirebase();
    });

    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(PHONE_NUMBER);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                console.log(`\n==============================================`);
                console.log(`🔑 كود اقتران الواتساب الخاص بك هو: [ ${code} ]`);
                console.log(`==============================================\n`);
            } catch (err) {}
        }, 5000);
    }

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const closeCode = lastDisconnect?.error?.output?.statusCode;
            if (closeCode === 440) {
                setTimeout(startBot, 15000);
            } else if (closeCode !== DisconnectReason.loggedOut) {
                setTimeout(startBot, 3000);
            }
        } else if (connection === 'open') {
            console.log('✅ تم تسجيل الدخول بنجاح وتفعيل البوت!');
            await saveAuthToFirebase();
            startPrayerCheckLoop(sock, subscribers, hadithSubscribers);
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg || !msg.message) return;

            const targetJid = msg.key.remoteJid;
            const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
            const cleanText = text.toLowerCase();

            // أسباب الإيقاف المخصصة
            if (cleanText === 'ايقاف الحديث' || cleanText === 'إيقاف الحديث') {
                if (hadithSubscribers[targetJid]) {
                    delete hadithSubscribers[targetJid];
                    await saveSubscribersToFirebase(subscribers, hadithSubscribers);
                    await sock.sendMessage(targetJid, { text: `🛑 *تم إيقاف التذكير الدوري بالأحاديث بنجاح.*` }, { quoted: msg });
                } else await sock.sendMessage(targetJid, { text: `ℹ️ لا يوجد تذكير بالأحاديث مفعّل لديك.` }, { quoted: msg });
                return;
            }

            if (cleanText === 'ايقاف القران' || cleanText === 'إيقاف القرآن') {
                if (quranTimers[targetJid]) {
                    clearInterval(quranTimers[targetJid]);
                    delete quranTimers[targetJid];
                    delete sequentialQuranProgress[targetJid];
                    await sock.sendMessage(targetJid, { text: `🛑 *تم إيقاف الإرسال التلقائي للقرآن بنجاح.*` }, { quoted: msg });
                } else await sock.sendMessage(targetJid, { text: `ℹ️ لا يوجد إرسال تلقائي للقرآن مفعّل لديك.` }, { quoted: msg });
                return;
            }

            if (cleanText === 'إيقاف' || cleanText === 'ايقاف') {
                let stopped = false;
                if (quranTimers[targetJid]) { clearInterval(quranTimers[targetJid]); delete quranTimers[targetJid]; delete sequentialQuranProgress[targetJid]; stopped = true; }
                if (hadithSubscribers[targetJid]) { delete hadithSubscribers[targetJid]; await saveSubscribersToFirebase(subscribers, hadithSubscribers); stopped = true; }
                await sock.sendMessage(targetJid, { text: stopped ? '🛑 تم إيقاف جميع التذكيرات التلقائية بنجاح.' : 'ℹ️ لا يوجد تذكير تلقائي مفعّل لديك.' }, { quoted: msg });
                return;
            }

            // توجيه الأوامر المباشرة للميزات
            const handledQuran = await handleQuranCommands(sock, targetJid, text, cleanText, msg);
            if (handledQuran) return;

            const handledHadith = await handleHadithCommands(sock, targetJid, text, subscribers, hadithSubscribers, msg);
            if (handledHadith) return;

            // أوامر الاشتراك والصلوات العامة
            if (cleanText.startsWith('اشتراك')) {
                const cityName = text.replace(/^اشتراك/i, '').trim();
                if (!cityName) return await sock.sendMessage(targetJid, { text: `❌ يرجى كتابة اسم المدينة بعد كلمة اشتراك.` }, { quoted: msg });

                const place = await getPlace(cityName);
                if (!place) return await sock.sendMessage(targetJid, { text: `❌ لم يتم العثور على المدينة.` }, { quoted: msg });

                const tz = place.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
                const rawTimings = await getPrayerTimings(place.latitude, place.longitude, tz);

                if (rawTimings) {
                    subscribers[targetJid] = { cityName: place.name, country: place.country || '', lat: place.latitude, lng: place.longitude, timezone: tz, rawTimings, lastFetchDate: new Date().toLocaleDateString('en-CA', { timeZone: tz }) };
                    await saveSubscribersToFirebase(subscribers, hadithSubscribers);
                    await sock.sendMessage(targetJid, { text: `✅ *تم الاشتراك بنجاح!*\n\n📍 *المدينة:* ${place.name}\n\n${getFormattedDate(tz).fullText}\n\n${formatTimingsSchedule(rawTimings, tz)}\n\n───────────────\n${await getRandomHadith()}` }, { quoted: msg });
                }
            }

            else if (cleanText === 'صلاتي' || cleanText === 'مواقتي') {
                const sub = subscribers[targetJid];
                if (!sub) return await sock.sendMessage(targetJid, { text: `غير مشترك حالياً. أرسل *اشتراك اسم_المدينة* للتفعيل.` }, { quoted: msg });
                await sock.sendMessage(targetJid, { text: `🕌 *مواقيت الصلاة*\n\n📍 *المدينة:* ${sub.cityName}\n\n${getFormattedDate(sub.timezone).fullText}\n\n${formatTimingsSchedule(sub.rawTimings || {}, sub.timezone)}` }, { quoted: msg });
            }

            else if (cleanText === 'فحص' || cleanText === 'ping') {
                await sock.sendMessage(targetJid, { text: `✅ البوت شغال ومتصل بنجاح مع المعمارية الجديدة!` }, { quoted: msg });
            }

            else if (cleanText === '.مساعدة' || cleanText === 'مساعدة') {
                await sock.sendMessage(targetJid, { text: `🕌 *بوت التذكير والإشعار الإسلامي الشامل*\n\n• *اشتراك اسم_المدينة* ➔ الاشتراك بمواقيت الصلاة.\n• *صلاتي* ➔ عرض جدول أوقات اليوم.\n• *صوت* أو *قرآن* ➔ اختيار قارئ وسماع آيات قرآنية.\n• *حديث 2د* ➔ تفعيل تذكير بالأحاديث والشرح.\n• *إيقاف القرآن* ➔ إيقاف الإرسال التلقائي للتلاوات الصوتية.\n• *إيقاف الحديث* ➔ إيقاف التذكير التلقائي بالأحاديث.\n• *إيقاف* ➔ إيقاف كافة التكرارات التلقائية معاً.` }, { quoted: msg });
            }

        } catch (err) {}
    });
}

startBot();
 
