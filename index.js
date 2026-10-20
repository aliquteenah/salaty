import express from 'express';
import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs';
import path from 'path';

// ================== 1. خادم Web وميزة منع الخمول (24/7 Keep-Alive) ==================
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('🕌 البوت يعمل بنجاح وعلى مدار 24 ساعة!');
});

app.listen(PORT, () => {
    console.log(`✅ خادم الويب يعمل على المنفذ: ${PORT}`);
});

// إرسال طلب ذاتي كل 5 دقائق لمنع Render من إيقاف الخدمة
const RENDER_URL = process.env.RENDER_EXTERNAL_URL;
if (RENDER_URL) {
    setInterval(() => {
        fetch(RENDER_URL).catch(() => {});
    }, 5 * 60 * 1000);
}

// ================== 2. إدارة المشتركين ==================
const SUBSCRIBERS_FILE = path.join(process.cwd(), 'prayer_subscribers.json');
let subscribers = {};

try {
    if (fs.existsSync(SUBSCRIBERS_FILE)) {
        subscribers = JSON.parse(fs.readFileSync(SUBSCRIBERS_FILE, 'utf8'));
    }
} catch (e) {
    console.log('خطأ في تحميل ملف المشتركين:', e.message);
}

const saveSubscribers = () => {
    try {
        fs.writeFileSync(SUBSCRIBERS_FILE, JSON.stringify(subscribers, null, 2));
    } catch (e) {
        console.log('خطأ في حفظ ملف المشتركين:', e.message);
    }
};

// ================== 3. قوائم الأحاديث والأدعية ==================
const HADITH_LIST = [
    {
        hadith: "«إِنَّ الصَّلَاةَ كَانَتْ عَلَى الْمُؤْمِنِينَ كِتَابًا مَوْقُوتًا»",
        source: "سورة النساء - آية 103"
    },
    {
        hadith: "«بُنِيَ الإِسْلاَمُ عَلَى خَمْسٍ: شَهَادَةِ أَنْ لاَ إِلَهَ إِلاَّ اللَّهُ وَأَنَّ مُحَمَّدًا رَسُولُ اللَّهِ، وَإِقَامِ الصَّلاَةِ، وَإِيتَاءِ الزَّكَاةِ، وَالحَجِّ، وَصَوْمِ رَمَضَانَ»",
        source: "صحيح البخاري"
    },
    {
        hadith: "سُئِلَ النَّبِيُّ ﷺ: أَيُّ الأَعْمَالِ أَفْضَلُ؟ قَالَ: «الصَّلاَةُ لِوَقْتِهَا»",
        source: "متفق عليه"
    },
    {
        hadith: "«مَنْ صَلَّى الْبَرْدَيْنِ دَخَلَ الْجَنَّةَ»",
        source: "صحيح البخاري (البردين: الفجر والعصر)"
    }
];

const BETWEEN_AZAN_IQAMA_DUAS = [
    "«اللَّهُمَّ رَبَّ هَذِهِ الدَّعْوَةِ التَّامَّةِ، وَالصَّلاَةِ الْقَائِمَةِ، آتِ مُحَمَّدًا الْوَسِيلَةَ وَالْفَضِيلَةَ، وَابْعَثْهُ مَقَامًا مَحْمُودًا الَّذِي وَعَدْتَهُ»",
    "«اللَّهُمَّ إِنِّي أَسْأَلُكَ الْعَفْوَ وَالْعَافِيَةَ فِي الدُّنْيَا وَالآخِرَةِ»",
    "«رَضِيتُ بِاللَّهِ رَبًّا، وَبِمُحَمَّدٍ رَسُولاً، وَبِالإِسْلاَمِ دِينًا»"
];

function getRandomItem(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function getRandomHadith() {
    const item = getRandomItem(HADITH_LIST);
    return `📜 *حديث اليوم:*\n${item.hadith}\n📚 *المصدر:* ${item.source}`;
}

// ================== 4. تنسيق الوقت وحساب القادمة ==================
const pad = (n) => String(n).padStart(2, '0');

function fmt12(timeStr) {
    if (!timeStr) return '--:--';
    const cleanTime = timeStr.split(' ')[0];
    const [h, mi] = cleanTime.split(':').map(Number);
    if (isNaN(h) || isNaN(mi)) return '--:--';
    const period = h >= 12 ? 'م' : 'ص';
    const h12 = h % 12 || 12;
    return `${h12}:${pad(mi)} ${period}`;
}

function fmtDur(min) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (h > 0 && m > 0) return `${h} ساعة و ${m} دقيقة`;
    if (h > 0) return `${h} ساعة`;
    return `${m} دقيقة`;
}

function getNextPrayerInfo(rawTimings = {}, timeZone) {
    const now = new Date();
    const nowStr = now.toLocaleTimeString('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false });
    const [currH, currM] = nowStr.split(':').map(Number);
    const nowMin = currH * 60 + currM;

    const names = { Fajr: 'الفجر', Dhuhr: 'الظهر', Asr: 'العصر', Maghrib: 'المغرب', Isha: 'العشاء' };
    const order = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];

    let nextKey = order.find((k) => {
        if (!rawTimings?.[k]) return false;
        const [h, m] = rawTimings[k].split(' ')[0].split(':').map(Number);
        return h * 60 + m > nowMin;
    });

    let diffMin = 0;
    if (nextKey && rawTimings?.[nextKey]) {
        const [h, m] = rawTimings[nextKey].split(' ')[0].split(':').map(Number);
        diffMin = h * 60 + m - nowMin;
    } else {
        nextKey = 'Fajr';
        if (rawTimings?.Fajr) {
            const [h, m] = rawTimings.Fajr.split(' ')[0].split(':').map(Number);
            diffMin = 1440 - nowMin + (h * 60 + m);
        }
    }

    return `⏳ القادمة: *${names[nextKey] || 'الفجر'}* بعد ${fmtDur(diffMin)}`;
}

function formatTimingsSchedule(rawTimings = {}, timeZone) {
    const list = [
        { name: 'الفجر', key: 'Fajr', icon: '🕌' },
        { name: 'الشروق', key: 'Sunrise', icon: '🌅' },
        { name: 'الظهر', key: 'Dhuhr', icon: '🕌' },
        { name: 'العصر', key: 'Asr', icon: '🕌' },
        { name: 'المغرب', key: 'Maghrib', icon: '🕌' },
        { name: 'العشاء', key: 'Isha', icon: '🕌' }
    ];

    const lines = list.map(item => {
        const rawTime = rawTimings?.[item.key] || '';
        return `${item.icon} ${item.name}: ${fmt12(rawTime)}`;
    }).join('\n');

    const nextInfo = getNextPrayerInfo(rawTimings, timeZone);

    return `${lines}\n\n${nextInfo}`;
}

// ================== 5. التاريخ الهجري والميلادي ==================
function getFormattedDate(timeZone) {
    const date = new Date();
    const dayName = new Intl.DateTimeFormat('ar-SA', { weekday: 'long', timeZone }).format(date);
    const gregorian = new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'long', year: 'numeric', timeZone }).format(date);
    const hijri = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone }).format(date);

    return {
        fullText: `📅 *اليوم:* ${dayName}\n📆 *التاريخ الميلادي:* ${gregorian}\n🌙 *التاريخ الهجري:* ${hijri} هـ`,
        dayName: dayName
    };
}

// ================== 6. جلب المواقيت الجغرافية ==================
async function getJson(url) {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
}

async function getPlace(cityName) {
    try {
        const j = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=ar`);
        return j.results?.[0] || null;
    } catch (e) {
        return null;
    }
}

async function getPrayerTimings(lat, lng, timezone) {
    try {
        const j = await getJson(`https://api.aladhan.com/v1/timings?latitude=${lat}&longitude=${lng}&method=4&timezonestring=${encodeURIComponent(timezone)}`);
        return j.data?.timings || null;
    } catch (e) {
        return null;
    }
}

// ================== 7. محرك التنبيهات الدورية ==================
const sentReminders = new Set();

function startPrayerCheckLoop(sock) {
    setInterval(async () => {
        const now = new Date();
        
        for (const [jid, info] of Object.entries(subscribers)) {
            try {
                const tz = info.timezone;
                if (!tz) continue;

                const localTimeStr = now.toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
                const [currH, currM] = localTimeStr.split(':').map(Number);
                const currentTotalMin = currH * 60 + currM;

                const todayDateStr = now.toLocaleDateString('en-CA', { timeZone: tz });
                if (!info.rawTimings || info.lastFetchDate !== todayDateStr) {
                    const newTimings = await getPrayerTimings(info.lat, info.lng, tz);
                    if (newTimings) {
                        subscribers[jid].rawTimings = newTimings;
                        subscribers[jid].lastFetchDate = todayDateStr;
                        saveSubscribers();
                    } else {
                        continue;
                    }
                }

                const rawTimings = subscribers[jid].rawTimings;
                if (!rawTimings) continue;

                const dateObj = getFormattedDate(tz);
                const hadithText = getRandomHadith();

                const prayersToCheck = [
                    { name: 'الفجر', key: 'Fajr' },
                    { name: 'الظهر', key: 'Dhuhr' },
                    { name: 'العصر', key: 'Asr' },
                    { name: 'المغرب', key: 'Maghrib' },
                    { name: 'العشاء', key: 'Isha' }
                ];

                for (const item of prayersToCheck) {
                    const prayerName = item.name;
                    const timeVal = rawTimings[item.key] ? rawTimings[item.key].split(' ')[0] : null;
                    if (!timeVal) continue;

                    const [pH, pM] = timeVal.split(':').map(Number);
                    const prayerTotalMin = pH * 60 + pM;

                    // قبل الصلاة بـ 30 دقيقة
                    const minBefore30 = prayerTotalMin - 30;
                    const key30 = `${jid}_${todayDateStr}_${prayerName}_30min`;
                    if (currentTotalMin === minBefore30 && !sentReminders.has(key30)) {
                        sentReminders.add(key30);
                        await sock.sendMessage(jid, {
                            text: `⏳ *تنبيه: قرب صلاة ${prayerName}* 🕌\n\n${dateObj.fullText}\n\nتبقّى 30 دقيقة على أذان صلاة *${prayerName}* في مدينة *${info.cityName}* (${info.country}).\n\n✨ _جهز نفسك للصلاة وتهيأ للوضوء_\n\n───────────────\n${hadithText}`
                        });
                    }

                    // عند الأذان
                    const keyExact = `${jid}_${todayDateStr}_${prayerName}_exact`;
                    if (currentTotalMin === prayerTotalMin && !sentReminders.has(keyExact)) {
                        sentReminders.add(keyExact);
                        await sock.sendMessage(jid, {
                            text: `🕌 *حان الآن أذان صلاة ${prayerName}* 🌸\n\n${dateObj.fullText}\n\nحان الآن موعد أذان صلاة *${prayerName}* حسب التوقيت المحلي لمدينة *${info.cityName}* (${info.country}).\n\n✨ _حيّ على الصلاة.. حيّ على الفلاح_\n\n───────────────\n${hadithText}`
                        });
                    }

                    // بين الأذان والإقامة
                    const minAfter10 = prayerTotalMin + 10;
                    const keyIqama = `${jid}_${todayDateStr}_${prayerName}_iqama`;
                    if (currentTotalMin === minAfter10 && !sentReminders.has(keyIqama)) {
                        sentReminders.add(keyIqama);
                        const duaItem = getRandomItem(BETWEEN_AZAN_IQAMA_DUAS);
                        await sock.sendMessage(jid, {
                            text: `🤲 *دعاء بين الأذان والإقامة (وقت مستجاب)* 🌟\n\nقال رسول الله ﷺ: «الدُّعَاءُ لاَ يُرَدُّ بَيْنَ الأَذَانِ وَالإِقَامَةِ»\n\n💡 *مِنَ الأَدْعِيَةِ الْمَأْثُورَةِ:*\n${duaItem}\n\n_استغل هذه اللحظات بالدعاء لنفسك ولمن تحب_ 🤍`
                        });
                    }
                }

            } catch (err) {
                console.log(`خطأ التذكير لـ ${jid}:`, err.message);
            }
        }

        if (sentReminders.size > 1000) sentReminders.clear();

    }, 30 * 1000);
}

// ================== 8. تشغيل البوت ==================
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('prayer_bot_auth');

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const closeCode = lastDisconnect?.error?.output?.statusCode;
            if (closeCode !== DisconnectReason.loggedOut) {
                setTimeout(startBot, 3000);
            }
        } else if (connection === 'open') {
            console.log('✅ تم تشغيل البوت بنجاح وهو يعمل الآن على مدار 24/7!');
            startPrayerCheckLoop(sock);
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (!msg.message) continue;

            const targetJid = msg.key.remoteJid;
            const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
            const cleanText = text.toLowerCase();
            const isFromMe = msg.key.fromMe;

            if (cleanText.startsWith('اشتراك')) {
                const cityName = text.replace(/^اشتراك/i, '').trim();
                if (!cityName) continue;

                const place = await getPlace(cityName);
                if (!place) {
                    await sock.sendMessage(targetJid, { text: `❌ لم يتم العثور على المدينة "${cityName}".` }, { quoted: msg });
                    continue;
                }

                const tz = place.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
                const rawTimings = await getPrayerTimings(place.latitude, place.longitude, tz);

                if (rawTimings) {
                    const todayDateStr = new Date().toLocaleDateString('en-CA', { timeZone: tz });
                    subscribers[targetJid] = {
                        cityName: place.name,
                        country: place.country || '',
                        lat: place.latitude,
                        lng: place.longitude,
                        timezone: tz,
                        rawTimings: rawTimings,
                        lastFetchDate: todayDateStr
                    };
                    saveSubscribers();

                    const dateObj = getFormattedDate(tz);
                    const timingsSchedule = formatTimingsSchedule(rawTimings, tz);

                    await sock.sendMessage(targetJid, {
                        text: `✅ *تم اشتراكك بنجاح!* ✨\n\n📍 *المدينة:* ${place.name} (${place.country || ''})\n\n${dateObj.fullText}\n\n${timingsSchedule}`
                    }, { quoted: msg });
                }
            } else if (cleanText === 'صلاتي' || cleanText === 'مواقتي') {
                const sub = subscribers[targetJid];
                if (!sub) continue;

                const dateObj = getFormattedDate(sub.timezone);
                const timingsSchedule = formatTimingsSchedule(sub.rawTimings || {}, sub.timezone);

                await sock.sendMessage(targetJid, {
                    text: `🕌 *مواقيت الصلاة الخاصة بك* 🌸\n\n📍 *المدينة:* ${sub.cityName} (${sub.country})\n\n${dateObj.fullText}\n\n${timingsSchedule}`
                }, { quoted: msg });
            }
        }
    });
}

startBot();
 
