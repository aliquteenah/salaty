import express from 'express';
import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs';
import path from 'path';

// ================== 1. خادم Web وميزة منع الخمول ==================
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('🕌 البوت يعمل بنجاح وعلى مدار 24 ساعة!');
});

app.listen(PORT, () => {
    console.log(`✅ خادم الويب يعمل على المنفذ: ${PORT}`);
});

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

// ================== 3. الأدعية والأحاديث والتوقيت ==================
const HADITH_LIST = [
    { hadith: "«إِنَّ الصَّلَاةَ كَانَتْ عَلَى الْمُؤْمِنِينَ كِتَابًا مَوْقُوتًا»", source: "سورة النساء - آية 103" },
    { hadith: "«سُئِلَ النَّبِيُّ ﷺ: أَيُّ الأَعْمَالِ أَفْضَلُ؟ قَالَ: الصَّلاَةُ لِوَقْتِهَا»", source: "متفق عليه" }
];

function getRandomItem(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function getRandomHadith() {
    const item = getRandomItem(HADITH_LIST);
    return `📜 *حديث اليوم:*\n${item.hadith}\n📚 *المصدر:* ${item.source}`;
}

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

    return `${lines}\n\n${getNextPrayerInfo(rawTimings, timeZone)}`;
}

function getFormattedDate(timeZone) {
    const date = new Date();
    const dayName = new Intl.DateTimeFormat('ar-SA', { weekday: 'long', timeZone }).format(date);
    const gregorian = new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'long', year: 'numeric', timeZone }).format(date);
    const hijri = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone }).format(date);

    return { fullText: `📅 *اليوم:* ${dayName}\n📆 *التاريخ الميلادي:* ${gregorian}\n🌙 *التاريخ الهجري:* ${hijri} هـ` };
}

async function getJson(url) {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
}

async function getPlace(cityName) {
    try {
        const j = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=ar`);
        return j.results?.[0] || null;
    } catch (e) { return null; }
}

async function getPrayerTimings(lat, lng, timezone) {
    try {
        const j = await getJson(`https://api.aladhan.com/v1/timings?latitude=${lat}&longitude=${lng}&method=4&timezonestring=${encodeURIComponent(timezone)}`);
        return j.data?.timings || null;
    } catch (e) { return null; }
}

// ================== 4. تشغيل الواتساب والمعالجة ==================
const PHONE_NUMBER = "966558513424";

async function startBot() {
    const { version } = await fetchLatestBaileysVersion();
    const { state, saveCreds } = await useMultiFileAuthState('prayer_bot_auth');

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        syncFullHistory: false,
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: false
    });

    sock.ev.on('creds.update', saveCreds);

    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(PHONE_NUMBER);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                console.log(`\n==============================================`);
                console.log(`🔑 كود اقتران الواتساب الخاص بك هو: [ ${code} ]`);
                console.log(`==============================================\n`);
            } catch (err) {
                console.log("خطأ كود الاقتران:", err.message);
            }
        }, 5000);
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const closeCode = lastDisconnect?.error?.output?.statusCode;
            console.log(`🔴 انقطع الاتصال (الرمز: ${closeCode}). جاري إعادة الاتصال...`);
            if (closeCode !== DisconnectReason.loggedOut) {
                setTimeout(startBot, 3000);
            }
        } else if (connection === 'open') {
            console.log('✅ تم تسجيل الدخول بنجاح البوت جاهز ويستجيب الآن!');
        }
    });

    // استلام كافة الرسائل دون استثناء
    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg || !msg.message) return;

            const targetJid = msg.key.remoteJid;
            const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
            const cleanText = text.toLowerCase();

            console.log(`📩 رسالة مستلمة من [${targetJid}]: ${text}`);

            // أمر الفحص والتأكد من العمل
            if (cleanText === 'فحص' || cleanText === 'تست' || cleanText === 'ping') {
                await sock.sendMessage(targetJid, { text: '✅ البوت شغال ومتصل بنجاح!' }, { quoted: msg });
            }

            // أمر الاشتراك
            else if (cleanText.startsWith('اشتراك')) {
                const cityName = text.replace(/^اشتراك/i, '').trim();
                if (!cityName) {
                    await sock.sendMessage(targetJid, { text: `❌ أرسل اسم المدينة بعد كلمة اشتراك.\nمثال: *اشتراك جازان*` }, { quoted: msg });
                    return;
                }

                await sock.sendMessage(targetJid, { text: `⏳ جاري جلب المواقيت لمدينة (${cityName})...` }, { quoted: msg });

                const place = await getPlace(cityName);
                if (!place) {
                    await sock.sendMessage(targetJid, { text: `❌ لم يتم العثور على المدينة "${cityName}".` }, { quoted: msg });
                    return;
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
                        text: `✅ *تم اشتراكك بنجاح!* ✨\n\n📍 *المدينة:* ${place.name} (${place.country || ''})\n\n${dateObj.fullText}\n\n${timingsSchedule}\n\n───────────────\n${getRandomHadith()}`
                    }, { quoted: msg });
                }
            }

            // أمر صلاتي / مواقتي
            else if (cleanText === 'صلاتي' || cleanText === 'مواقتي') {
                const sub = subscribers[targetJid];
                if (!sub) {
                    await sock.sendMessage(targetJid, { text: `أنت غير مشترك حالياً. أرسل *اشتراك اسم_المدينة* للتفعيل.` }, { quoted: msg });
                    return;
                }

                const dateObj = getFormattedDate(sub.timezone);
                const timingsSchedule = formatTimingsSchedule(sub.rawTimings || {}, sub.timezone);

                await sock.sendMessage(targetJid, {
                    text: `🕌 *مواقيت الصلاة الخاصة بك* 🌸\n\n📍 *المدينة:* ${sub.cityName} (${sub.country})\n\n${dateObj.fullText}\n\n${timingsSchedule}`
                }, { quoted: msg });
            }

        } catch (err) {
            console.log('خطأ معالجة الرسالة:', err.message);
        }
    });
}

startBot();
 
