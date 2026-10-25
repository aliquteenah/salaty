import express from 'express';
import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, delay } from '@whiskeysockets/baileys';
import pino from 'pino';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

import { restoreSubscribersFromFirebase, saveSubscribersToFirebase, restoreAuthFromFirebase, saveAuthToFirebase } from './config/firebase.js';
import { unwrap, getText, getFormattedDate } from './utils/helpers.js';
import { messageStore, saveMedia, handleAntiDeleteAndEdit } from './features/antiDelete.js';
import { sendHumanTextToSpeech, sendTransparentSticker } from './features/ttsSticker.js';
import { startReminderLoop, handleRemindersAndWeather } from './features/remindersWeather.js';
import { quranTimers, sequentialQuranProgress, handleQuranCommands } from './features/quran.js';
import { handleHadithCommands, getRandomHadith } from './features/hadith.js';
import { getPlace, getPrayerTimings, formatTimingsSchedule, startPrayerCheckLoop, handlePrayerCommands, makePrayerCard } from './features/prayer.js';

// استيراد الميزات المفصولة الجديدة
import { handleQuranTafseerCommands } from './features/quranTafseer.js';
import { handleDuaCommands } from './features/duas.js';
import { handleHisnCommands } from './features/hisnMuslim.js';
import { handleQuoteCommands } from './features/quotes.js';
import { handleThoughtCommands } from './features/thoughts.js';

const HELP_TEXT = `╮───────────────╭ـ
│「❥📲 **قائمة الأوامر** 📃❥」
│───────────────╰ـ
*╮ ───═┅─┅─┅═─── ╭*
│⚝ ⃟🎖️❯ 🎙️ *.حامد نص* ➔ تحويل لـ صوت رجالي
│⚝ ⃟🧰❯ 🎙️ *.صالحة نص* ➔ تحويل لـ صوت أنثوي
│⚝ ⃟⚓❯ 🖼️ *.ملصق نص* ➔ صنع ملصق شفاف
│⚝ ⃟💎❯ ⏰ *.ذكرني 30د نص* ➔ ضبط تذكير شخصي
│⚝ ⃟👾❯ 🌤️ *.طقس مدينة* ➔ حالة الطقس المباشر
│⚝ ⃟🪙❯ 🕌 *اشتراك مدينة* ➔ تفعيل تنبيهات الصلاة
│⚝ ⃟🎟️❯ 🕌 *صلاتي* ➔ عرض مواقيت اليوم
│⚝ ⃟🎖️❯ 🎧 *صوت / قرآن* ➔ التلاوات الصوتية
│⚝ ⃟🧰❯ 📖 *.آية* (أو *.آية 5د*) ➔ آيات مع التفسير
│⚝ ⃟⚓❯ 🤲 *.دعاء* (أو *.دعاء 5د*) ➔ أدعية قرآنية
│⚝ ⃟💎❯ 🛡️ *.حصن* (أو *.حصن 5د*) ➔ أذكار حصن المسلم
│⚝ ⃟👾❯ 💡 *.حكمة* (أو *.حكمة 5د*) ➔ حكم واقتباسات
│⚝ ⃟🪙❯ ✍️ *.خاطرة* (أو *.خاطرة 5د*) ➔ خواطر وأدب
│⚝ ⃟🎟️❯ 📜 *حديث 2د* ➔ تذكير الأحاديث الدوري
│⚝ ⃟⚓❯ 🛑 *إيقاف* ➔ إلغاء التنبيهات التلقائية
*╯ ───═┅─┅─┅═─── ╰*`;

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => res.send('🕌 البوت الشامل يعمل بنجاح ومربوط بـ Firebase!'));
app.listen(PORT, '0.0.0.0', () => console.log(`✅ خادم الويب يعمل على المنفذ: ${PORT}`));

const RENDER_URL = process.env.RENDER_EXTERNAL_URL;
if (RENDER_URL) {
    setInterval(() => { fetch(RENDER_URL).catch(() => {}); }, 5 * 60 * 1000);
}

let subscribers = {};
let hadithSubscribers = {};
const PHONE_NUMBER = "966551138192";

async function cleanTempFiles(sock, jid, msg) {
    try {
        let deletedCount = 0;
        const currentDir = process.cwd();
        fs.readdirSync(currentDir).forEach((file) => {
            if (file.startsWith('temp_') || file.endsWith('.tmp') || file.endsWith('.log')) {
                try { fs.unlinkSync(path.join(currentDir, file)); deletedCount++; } catch (e) {}
            }
        });
        messageStore.clear();
        await sock.sendMessage(jid, { text: `🧹 *تم التنظيف بنجاح!*\n✅ تم حذف ${deletedCount} ملفاً مؤقتاً وتفريغ الذاكرة.` }, { quoted: msg });
    } catch (err) {
        await sock.sendMessage(jid, { text: "❌ حدث خطأ أثناء التنظيف." }, { quoted: msg });
    }
}

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
            if (closeCode === DisconnectReason.loggedOut) {
                console.log("تم تسجيل الخروج.");
            } else if (closeCode === 440) {
                setTimeout(startBot, 15000);
            } else {
                setTimeout(startBot, 3000);
            }
        } else if (connection === 'open') {
            console.log('✅ تم تسجيل الدخول بنجاح وتفعيل البوت بكافة ميزاته الشاملة!');
            await saveAuthToFirebase();
            startPrayerCheckLoop(sock, subscribers, hadithSubscribers);
            startReminderLoop(sock);
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (!msg.message) continue;

            const m = unwrap(msg.message);
            if (!m) continue;

            const targetJid = msg.key.remoteJid;
            const msgId = msg.key.id;
            const proto = m.protocolMessage;

            if (proto) {
                await handleAntiDeleteAndEdit(sock, msg, proto);
                continue;
            }

            messageStore.set(msgId, { key: msg.key, message: m });
            setTimeout(() => messageStore.delete(msgId), 30 * 60 * 1000);
            saveMedia(sock, msg, m);

            const originalText = getText(m) || '';
            const cleanText = originalText.trim().toLowerCase();

            if (cleanText === 'ايقاف الحديث' || cleanText === 'إيقاف الحديث') {
                if (hadithSubscribers[targetJid]) {
                    delete hadithSubscribers[targetJid];
                    await saveSubscribersToFirebase(subscribers, hadithSubscribers);
                    await sock.sendMessage(targetJid, { text: `🛑 *تم إيقاف التذكير الدوري بالأحاديث بنجاح.*` }, { quoted: msg });
                } else await sock.sendMessage(targetJid, { text: `ℹ️ لا يوجد تذكير بالأحاديث مفعّل لديك.` }, { quoted: msg });
                continue;
            }

            if (cleanText === 'ايقاف القران' || cleanText === 'إيقاف القرآن') {
                if (quranTimers[targetJid]) {
                    clearInterval(quranTimers[targetJid]);
                    delete quranTimers[targetJid];
                    delete sequentialQuranProgress[targetJid];
                    await sock.sendMessage(targetJid, { text: `🛑 *تم إيقاف الإرسال التلقائي للقرآن بنجاح.*` }, { quoted: msg });
                } else await sock.sendMessage(targetJid, { text: `ℹ️ لا يوجد إرسال تلقائي للقرآن مفعّل لديك.` }, { quoted: msg });
                continue;
            }

            if (cleanText === 'إيقاف' || cleanText === 'ايقاف') {
                let stopped = false;
                if (quranTimers[targetJid]) { clearInterval(quranTimers[targetJid]); delete quranTimers[targetJid]; delete sequentialQuranProgress[targetJid]; stopped = true; }
                if (hadithSubscribers[targetJid]) { delete hadithSubscribers[targetJid]; await saveSubscribersToFirebase(subscribers, hadithSubscribers); stopped = true; }
                await sock.sendMessage(targetJid, { text: stopped ? '🛑 تم إيقاف جميع التذكيرات التلقائية بنجاح.' : 'ℹ️ لا يوجد تذكير تلقائي مفعّل لديك.' }, { quoted: msg });
                continue;
            }

            // تنفيذ معالجات الميزات الجديدة المفصولة
            if (await handleQuranTafseerCommands(sock, msg, targetJid, cleanText)) continue;
            if (await handleDuaCommands(sock, msg, targetJid, cleanText)) continue;
            if (await handleHisnCommands(sock, msg, targetJid, cleanText)) continue;
            if (await handleQuoteCommands(sock, msg, targetJid, cleanText)) continue;
            if (await handleThoughtCommands(sock, msg, targetJid, cleanText)) continue;

            // تنفيذ معالجات الميزات المعتادة
            if (await handleQuranCommands(sock, targetJid, originalText, cleanText, msg)) continue;
            if (await handleHadithCommands(sock, targetJid, originalText, subscribers, hadithSubscribers, msg)) continue;
            if (await handlePrayerCommands(sock, targetJid, originalText, cleanText, subscribers, hadithSubscribers, msg)) continue;
            if (await handleRemindersAndWeather(sock, msg, targetJid, originalText)) continue;

            if (['.مساعدة', '.مساعده', 'مساعدة', 'مساعده', 'اوامر', 'الأوامر', '.اوامر', '.الأوامر'].includes(cleanText)) {
                await sock.sendMessage(targetJid, { text: HELP_TEXT }, { quoted: msg });
                continue;
            }

            if (cleanText === '.تنظيف' && msg.key.fromMe) {
                await cleanTempFiles(sock, targetJid, msg);
                continue;
            }

            if (originalText.startsWith('.صوت') || originalText.startsWith('.حامد') || originalText.startsWith('صوت') || originalText.startsWith('حامد')) {
                const textToSpeech = originalText.replace(/^(\.صوت|\.حامد|صوت|حامد)/i, '').trim();
                if (textToSpeech) await sendHumanTextToSpeech(sock, targetJid, msg, textToSpeech, 'hamed');
                continue;
            }

            if (originalText.startsWith('.صالحة') || originalText.startsWith('.صالحه') || originalText.startsWith('صالحة') || originalText.startsWith('صالحه')) {
                const textToSpeech = originalText.replace(/^(\.صالحة|\.صالحه|صالحة|صالحه)/i, '').trim();
                if (textToSpeech) await sendHumanTextToSpeech(sock, targetJid, msg, textToSpeech, 'saliha');
                continue;
            }

            if (originalText.startsWith('.ملصق') || originalText.startsWith('ملصق')) {
                const textToConvert = originalText.replace(/^(\.ملصق|ملصق)/i, '').trim();
                if (textToConvert) await sendTransparentSticker(sock, targetJid, msg, textToConvert);
                continue;
            }

            if (cleanText.startsWith('اشتراك')) {
                const cityName = originalText.replace(/^اشتراك/i, '').trim();
                if (!cityName) { await sock.sendMessage(targetJid, { text: `❌ يرجى كتابة اسم المدينة بعد كلمة اشتراك.` }, { quoted: msg }); continue; }

                const place = await getPlace(cityName);
                if (!place) { await sock.sendMessage(targetJid, { text: `❌ لم يتم العثور على المدينة.` }, { quoted: msg }); continue; }

                const tz = place.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
                const rawTimings = await getPrayerTimings(place.latitude, place.longitude, tz);

                if (rawTimings) {
                    subscribers[targetJid] = { cityName: place.name, country: place.country || '', lat: place.latitude, lng: place.longitude, timezone: tz, rawTimings, lastFetchDate: new Date().toLocaleDateString('en-CA', { timeZone: tz }) };
                    await saveSubscribersToFirebase(subscribers, hadithSubscribers);
                    
                    const card = makePrayerCard('تم الاشتراك بنجاح', place.name, place.country || '', formatTimingsSchedule(rawTimings, tz), await getRandomHadith());
                    await sock.sendMessage(targetJid, { text: card }, { quoted: msg });
                }
                continue;
            }

            if (cleanText === 'صلاتي' || cleanText === 'مواقتي') {
                const sub = subscribers[targetJid];
                if (!sub) { await sock.sendMessage(targetJid, { text: `غير مشترك حالياً. أرسل *اشتراك اسم_المدينة* للتفعيل.` }, { quoted: msg }); continue; }
                const card = makePrayerCard('مواقيت الصلاة اليومية', sub.cityName, sub.country || '', formatTimingsSchedule(sub.rawTimings || {}, sub.timezone));
                await sock.sendMessage(targetJid, { text: card }, { quoted: msg });
                continue;
            }

            if (cleanText === 'فحص' || cleanText === 'ping') {
                await sock.sendMessage(targetJid, { text: `✅ البوت شغال ومتصل بنجاح بكافة ميزاته الشاملة!` }, { quoted: msg });
                continue;
            }
        }
    });
}

startBot();
 
