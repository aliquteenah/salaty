import express from 'express';
import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set, get, child, remove } from 'firebase/database';

// ================== 1. خادم Web وميزة منع الخمول ==================
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('🕌 البوت يعمل بنجاح وعلى مدار 24 ساعة ومربوط بـ Firebase!');
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

// ================== 2. إعداد وقاعدة بيانات Firebase ==================
const firebaseConfig = {
    databaseURL: "https://salaty-ed58a-default-rtdb.firebaseio.com"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);

const AUTH_DIR = path.join(process.cwd(), 'prayer_bot_auth');
if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
}

let subscribers = {};
let hadithSubscribers = {}; // لحفظ اشتراكات الأحاديث المجدولة (حديث Xد)

// 1. استرجاع البيانات من Firebase عند الإقلاع
async function restoreSubscribersFromFirebase() {
    try {
        const dbRef = ref(db);
        const snapshot = await get(child(dbRef, 'subscribers'));
        if (snapshot.exists()) {
            subscribers = snapshot.val() || {};
            console.log(`✅ تم استرجاع (${Object.keys(subscribers).length}) مشترك/مجموعة من Firebase بنجاح!`);
        }
        
        const hadithSnap = await get(child(dbRef, 'hadith_subscribers'));
        if (hadithSnap.exists()) {
            hadithSubscribers = hadithSnap.val() || {};
            console.log(`✅ تم استرجاع (${Object.keys(hadithSubscribers).length}) اشتراك أحاديث دورية بنجاح!`);
        }
    } catch (e) {
        console.log("❌ خطأ جلب المشتركين من Firebase:", e.message);
    }
}

// 2. حفظ وتحديث المشتركين في Firebase
async function saveSubscribersToFirebase() {
    try {
        await set(ref(db, 'subscribers'), subscribers);
        await set(ref(db, 'hadith_subscribers'), hadithSubscribers);
    } catch (e) {
        console.log("❌ خطأ حفظ المشتركين في Firebase:", e.message);
    }
}

// 3. استرجاع الجلسة من Firebase عند الإقلاع
async function restoreAuthFromFirebase() {
    try {
        const dbRef = ref(db);
        const snapshot = await get(child(dbRef, 'auth_session'));
        if (snapshot.exists()) {
            const authFiles = snapshot.val();
            if (!fs.existsSync(AUTH_DIR)) {
                fs.mkdirSync(AUTH_DIR, { recursive: true });
            }
            for (const [safeFilename, contentBase64] of Object.entries(authFiles)) {
                const filename = safeFilename.replace(/_DOT_/g, '.');
                const fileBuf = Buffer.from(contentBase64, 'base64');
                fs.writeFileSync(path.join(AUTH_DIR, filename), fileBuf);
            }
            console.log("✅ تم استرجاع جلسة الواتساب من Firebase بنجاح!");
        }
    } catch (e) {
        console.log("❌ خطأ استرجاع الجلسة من Firebase:", e.message);
    }
}

// 4. حفظ وتحديث ملفات الجلسة في Firebase
async function saveAuthToFirebase() {
    try {
        if (!fs.existsSync(AUTH_DIR)) return;
        const files = fs.readdirSync(AUTH_DIR);
        const authData = {};

        for (const file of files) {
            const filePath = path.join(AUTH_DIR, file);
            if (fs.statSync(filePath).isFile()) {
                const safeFileName = file.replace(/\./g, '_DOT_');
                authData[safeFileName] = fs.readFileSync(filePath).toString('base64');
            }
        }

        await set(ref(db, 'auth_session'), authData);
    } catch (e) {
        console.log("❌ خطأ حفظ الجلسة في Firebase:", e.message);
    }
}

// ================== 3. الأدعية والأحاديث والتوقيت ==================
const BACKUP_HADITHS = [
    { hadith: "«إِنَّ الصَّلَاةَ كَانَتْ عَلَى الْمُؤْمِنِينَ كِتَابًا مَوْقُوتًا»", source: "سورة النساء - آية 103" },
    { hadith: "«بُنِيَ الإِسْلاَمُ عَلَى خَمْسٍ: شَهَادَةِ أَنْ لاَ إِلَهَ إِلاَّ اللَّهُ وَأَنَّ مُحَمَّدًا رَسُولُ اللَّهِ، وَإِقَامِ الصَّلاَةِ، وَإِيتَاءِ الزَّكَاةِ، وَالحَجِّ، وَصَوْمِ رَمَضَانَ»", source: "صحيح البخاري" },
    { hadith: "«سُئِلَ النَّبِيُّ ﷺ: أَيُّ الأَعْمَالِ أَفْضَلُ؟ قَالَ: الصَّلاَةُ لِوَقْتِهَا»", source: "متفق عليه" },
    { hadith: "«مَنْ صَلَّى الْبَرْدَيْنِ دَخَلَ الْجَنَّةَ»", source: "صحيح البخاري (البردين: الفجر والعصر)" }
];

const BETWEEN_AZAN_IQAMA_DUAS = [
    "«اللَّهُمَّ رَبَّ هَذِهِ الدَّعْوَةِ التَّامَّةِ، وَالصَّلاَةِ الْقَائِمَةِ، آتِ مُحَمَّدًا الْوَسِيلَةَ وَالْفَضِيلَةَ، وَابْعَثْهُ مَقَامًا مَحْمُودًا الَّذِي وَعَدْتَهُ»",
    "«اللَّهُمَّ إِنِّي أَسْأَلُكَ الْعَفْوَ وَالْعَافِيَةَ فِي الدُّنْيَا وَالآخِرَةِ»",
    "«رَضِيتُ بِاللَّهِ رَبًّا، وَبِمُحَمَّدٍ رَسُولاً، وَبالإِسْلاَمِ دِينًا»"
];

function getRandomItem(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

// دالة جلب حديث نبوي مع الشرح والدرجة والمصدر من HadeethEnc
async function getRandomHadith() {
    try {
        const categories = [2, 3, 4, 5]; 
        const randomCat = getRandomItem(categories);

        const res = await fetch(`https://hadeethenc.com/api/v1/hadeeths/list/?language=ar&category_id=${randomCat}&page=1&per_page=20`, {
            signal: AbortSignal.timeout(5000)
        });

        if (res.ok) {
            const data = await res.json();
            if (data && data.data && data.data.length > 0) {
                const randomItem = getRandomItem(data.data);
                
                const detailRes = await fetch(`https://hadeethenc.com/api/v1/hadeeths/one/?language=ar&id=${randomItem.id}`, {
                    signal: AbortSignal.timeout(5000)
                });

                if (detailRes.ok) {
                    const detailData = await detailRes.json();
                    let text = `📜 *حديث اليوم (من موسوعة HadeethEnc):*\n«${detailData.hadeeth.trim()}»`;
                    
                    if (detailData.explanation) {
                        text += `\n\n💡 *الشرح:* ${detailData.explanation.trim()}`;
                    }

                    if (detailData.attribution) text += `\n\n📚 *المصدر:* ${detailData.attribution}`;
                    if (detailData.grade) text += `\n✨ *درجة الحديث:* ${detailData.grade}`;
                    return text;
                }
            }
        }
    } catch (e) {}

    const backup = getRandomItem(BACKUP_HADITHS);
    return `📜 *حديث اليوم:*\n${backup.hadith}\n📚 *المصدر:* ${backup.source}`;
}

// دالة مخصصة لجلب الحديث مع الشرح فقط (لخدمة التذكير الدوري)
async function getHadithWithExplanationOnly() {
    try {
        const categories = [2, 3, 4, 5];
        const randomCat = getRandomItem(categories);

        const res = await fetch(`https://hadeethenc.com/api/v1/hadeeths/list/?language=ar&category_id=${randomCat}&page=1&per_page=25`, {
            signal: AbortSignal.timeout(5000)
        });

        if (res.ok) {
            const data = await res.json();
            if (data && data.data && data.data.length > 0) {
                const randomItem = getRandomItem(data.data);

                const detailRes = await fetch(`https://hadeethenc.com/api/v1/hadeeths/one/?language=ar&id=${randomItem.id}`, {
                    signal: AbortSignal.timeout(5000)
                });

                if (detailRes.ok) {
                    const detailData = await detailRes.json();
                    let text = `📜 *حديث نبوي شريف:*\n«${detailData.hadeeth.trim()}»`;

                    if (detailData.explanation) {
                        text += `\n\n💡 *الشرح:* ${detailData.explanation.trim()}`;
                    }
                    return text;
                }
            }
        }
    } catch (e) {}

    const backup = getRandomItem(BACKUP_HADITHS);
    return `📜 *حديث نبوي شريف:*\n${backup.hadith}`;
}

const pad = (n) => String(n).padStart(2, '0');

function fmt12(timeStr) {
    if (!timeStr) return '--:--';
    const cleanTime = timeStr.split(' ')[0];
    const [h, mi] = cleanTime.split(':').map(Number);
    if (isNaN(h) || isNaN(mi)) return '--:--';
    const period = h >= 12 ? 'م' : 'ص';
    const h12 = h % 12 || 12;
    return `${h12}:${pad(mi)}${period}`;
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

    return `⏳ القادمة: *${names[nextKey] \vert{}\vert{} 'الفجر'}* بعد ${fmtDur(diffMin)}`;
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
        return `${item.icon} ${item.name}:${fmt12(rawTime)}`;
    }).join('\n');

    return `${lines}\n\n${getNextPrayerInfo(rawTimings, timeZone)}`;
}

function getFormattedDate(timeZone) {
    const date = new Date();
    const dayName = new Intl.DateTimeFormat('ar-SA', { weekday: 'long', timeZone }).format(date);
    const gregorian = new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'long', year: 'numeric', timeZone }).format(date);
    const hijri = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone }).format(date);

    return { fullText: `📅 *اليوم:* ${dayName}\n📆 *التاريخ الميلادي:* ${gregorian}\n🌙 *التاريخ الهجري:* ${hijri} هـ`, dayName: dayName };
}

async function getJson(url) {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
}

// دالة دقيقة ومحدثة للبحث عن المناطق والمدن وتفادي التداخل الجغرافي
async function getPlace(cityName) {
    try {
        const j = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=10&language=ar`);
        if (!j.results || j.results.length === 0) return null;
        
        // إعطاء أولوية مطلقة للعواصم (PPLC) ثم عواصم المحافظات/الولايات الكبرى (PPLA)
        const capital = j.results.find(r => r.feature_code === 'PPLC');
        if (capital) return capital;

        const majorCity = j.results.find(r => r.feature_code && r.feature_code.startsWith('PPLA'));
        if (majorCity) return majorCity;

        return j.results[0];
    } catch (e) { 
        return null; 
    }
}

async function getPrayerTimings(lat, lng, timezone) {
    try {
        const j = await getJson(`https://api.aladhan.com/v1/timings?latitude=${lat}&longitude=${lng}&method=4&timezonestring=${encodeURIComponent(timezone)}`);
        return j.data?.timings || null;
    } catch (e) { return null; }
}

// ================== 4. محرك التنبيهات الدورية ==================
const sentReminders = new Set();

function startPrayerCheckLoop(sock) {
    setInterval(async () => {
        const now = new Date();
        const nowMs = Date.now();

        // 1. فحص إرسال الأحاديث المجدولة كل X دقائق
        for (const [jid, config] of Object.entries(hadithSubscribers)) {
            try {
                if (!config.intervalMinutes || config.intervalMinutes <= 0) continue;
                
                const intervalMs = config.intervalMinutes * 60 * 1000;
                const lastSent = config.lastSentTime || 0;

                if (nowMs - lastSent >= intervalMs) {
                    hadithSubscribers[jid].lastSentTime = nowMs;
                    await saveSubscribersToFirebase();

                    const hadithText = await getHadithWithExplanationOnly();
                    await sock.sendMessage(jid, { text: hadithText });
                }
            } catch (err) {
                console.log(`خطأ التذكير الدوري بالحديث لـ ${jid}:`, err.message);
            }
        }

        // 2. فحص مواقيت الصلاة والأذكار
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
                        await saveSubscribersToFirebase();
                    } else {
                        continue;
                    }
                }

                const rawTimings = subscribers[jid].rawTimings;
                if (!rawTimings) continue;

                const dateObj = getFormattedDate(tz);
                const hadithText = await getRandomHadith();

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

                // أذكار الصباح
                if (rawTimings['Fajr']) {
                    const [fH, fM] = rawTimings['Fajr'].split(' ')[0].split(':').map(Number);
                    const morningAzkarMin = fH * 60 + fM + 20;
                    const keyMorningAzkar = `${jid}_${todayDateStr}_morning_azkar`;
                    if (currentTotalMin === morningAzkarMin && !sentReminders.has(keyMorningAzkar)) {
                        sentReminders.add(keyMorningAzkar);
                        await sock.sendMessage(jid, {
                            text: `🌅 *تذكير بأذكار الصباح* 🌸\n\nأصبحنا وأصبح الملك لله والحمد لله.. لا تنسَ قراءة أذكار الصباح لتحفظك وتنوّر يومك ✨\n\n«أَلا بِذِكْرِ اللَّهِ تَطْمَئِنُّ الْقُلُوبُ»`
                        });
                    }
                }

                // أذكار المساء
                if (rawTimings['Asr']) {
                    const [aH, aM] = rawTimings['Asr'].split(' ')[0].split(':').map(Number);
                    const eveningAzkarMin = aH * 60 + aM + 20;
                    const keyEveningAzkar = `${jid}_${todayDateStr}_evening_azkar`;
                    if (currentTotalMin === eveningAzkarMin && !sentReminders.has(keyEveningAzkar)) {
                        sentReminders.add(keyEveningAzkar);
                        await sock.sendMessage(jid, {
                            text: ```🌆 *تذكير بأذكار المساء* 🌙\n\nأمسينا وأمسى الملك لله.. حان وقت حصنك اليومي بقراءة أذكار المساء 🤍`
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

// ================== 5. تشغيل الواتساب والمعالجة الشاملة ==================
const PHONE_NUMBER = "966551138192";

async function startBot() {
    await restoreAuthFromFirebase();
    await restoreSubscribersFromFirebase();

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
            } catch (err) {
                console.log("خطأ كود الاقتران:", err.message);
            }
        }, 5000);
    }

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const closeCode = lastDisconnect?.error?.output?.statusCode;
            console.log(`🔴 انقطع الاتصال (الرمز: ${closeCode}). جاري إعادة الاتصال...`);
            if (closeCode !== DisconnectReason.loggedOut) {
                setTimeout(startBot, 3000);
            }
        } else if (connection === 'open') {
            console.log('✅ تم تسجيل الدخول بنجاح! تم ربط واسترجاع البيانات من Firebase.');
            await saveAuthToFirebase();
            startPrayerCheckLoop(sock);
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg || !msg.message) return;

            const targetJid = msg.key.remoteJid;
            const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
            const cleanText = text.toLowerCase();
            const isFromMe = msg.key.fromMe;

            // 0. أمر المطور الخص بحذف الملفات وعقد Firebase غير المرغوب فيها (.تنظيف اسم_العقدة)
            if (cleanText.startsWith('.تنظيف') || cleanText.startsWith('.حذف_قاعدة') || cleanText.startsWith('.مسح_قاعدة')) {
                if (!isFromMe) return;

                const targetNode = text.replace(/^(\.تنظيف|\.حذف_قاعدة|\.مسح_قاعدة)/i, '').trim();

                if (targetNode) {
                    try {
                        await remove(ref(db, targetNode));
                        await sock.sendMessage(targetJid, { text: `🗑️ *تم حذف العقدة (${targetNode}) بنجاح من قاعدة البيانات Firebase.*` }, { quoted: msg });
                        
                        if (targetNode === 'auth_session') {
                            if (fs.existsSync(AUTH_DIR)) fs.rmSync(AUTH_DIR, { recursive: true, force: true });
                            await sock.sendMessage(targetJid, { text: `🔄 جاري إعادة تشغيل البوت وتوليد كود اقتران جديد...` });
                            process.exit(0);
                        } else if (targetNode === 'subscribers') {
                            subscribers = {};
                        } else if (targetNode === 'hadith_subscribers') {
                            hadithSubscribers = {};
                        }
                    } catch (e) {
                        await sock.sendMessage(targetJid, { text: `❌ حدث خطأ أثناء الحذف: ${e.message}` }, { quoted: msg });
                    }
                } 
                else {
                    try {
                        await remove(ref(db, 'auth_session'));
                        if (fs.existsSync(AUTH_DIR)) fs.rmSync(AUTH_DIR, { recursive: true, force: true });
                        await sock.sendMessage(targetJid, { text: `🧹 *تم تنظيف الجلسة المخزنة في Firebase بنجاح!*\n\n🔄 جاري إعادة التشغيل وتوليد كود جديد...` }, { quoted: msg });
                        process.exit(0);
                    } catch (e) {
                        await sock.sendMessage(targetJid, { text: `❌ خطأ في التنظيف: ${e.message}` }, { quoted: msg });
                    }
                }
                return;
            }

            // 1. أمر التذكير الدوري بالأحاديث (مثال: حديث 2د أو حديث 10د)
            const hadithMatch = text.match(/^حديث\s*(\d+)\s*د/i);
            if (hadithMatch) {
                const mins = parseInt(hadithMatch[1], 10);
                if (mins && mins > 0) {
                    hadithSubscribers[targetJid] = {
                        intervalMinutes: mins,
                        lastSentTime: Date.now()
                    };
                    await saveSubscribersToFirebase();

                    await sock.sendMessage(targetJid, {
                        text: `✅ *تم تفعيل التذكير الدوري بالأحاديث الشريفة!*\n\nسيتم إرسال حديث نبوي شريف مع الشرح كل *${mins} دقيقة* تلقائياً. 📜✨\n\n_لإيقاف التذكير في أي وقت أرسل:_ *ايقاف الحديث*`
                    }, { quoted: msg });

                    const firstHadith = await getHadithWithExplanationOnly();
                    await sock.sendMessage(targetJid, { text: firstHadith });
                    return;
                }
            }

            // أمر إيقاف التذكير الدوري بالأحاديث
            else if (cleanText === 'ايقاف الحديث' || cleanText === 'إيقاف الحديث' || cleanText === 'الغاء الحديث' || cleanText === 'إلغاء الحديث') {
                if (hadithSubscribers[targetJid]) {
                    delete hadithSubscribers[targetJid];
                    await saveSubscribersToFirebase();
                    await sock.sendMessage(targetJid, { text: `🛑 *تم إيقاف التذكير الدوري بالأحاديث بنجاح.*` }, { quoted: msg });
                } else {
                    await sock.sendMessage(targetJid, { text: `لا يوجد تذكير دوري بالأحاديث مفعّل حالياً.` }, { quoted: msg });
                }
                return;
            }

            // 2. أمر الاشتراك في أوقات الصلاة
            if (cleanText.startsWith('اشتراك')) {
                const cityName = text.replace(/^اشتراك/i, '').trim();
                if (!cityName) {
                    await sock.sendMessage(targetJid, { text: `❌ يرجى كتابة اسم المدينة بعد كلمة اشتراك.\nمثال: *اشتراك جازان*` }, { quoted: msg });
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
                    await saveSubscribersToFirebase();

                    const dateObj = getFormattedDate(tz);
                    const timingsSchedule = formatTimingsSchedule(rawTimings, tz);
                    const hadithText = await getRandomHadith();

                    await sock.sendMessage(targetJid, {
                        text: `✅ *تم الاشتراك بنجاح!* ✨\n\n📍 *المدينة:* ${place.name} (${place.country || ''})\n\n${dateObj.fullText}\n\n${timingsSchedule}\n\n───────────────\n${hadithText}`
                    }, { quoted: msg });
                }
            }

            // 3. أمر تعديل المدينة
            else if (cleanText.startsWith('تعديل') || cleanText.startsWith('تغيير')) {
                const newCity = text.replace(/^(تعديل|تغيير)/i, '').trim();
                if (!newCity) {
                    await sock.sendMessage(targetJid, { text: `❌ يرجى كتابة اسم المدينة الجديد بعد الأمر.\nمثال: *تعديل جازان*` }, { quoted: msg });
                    return;
                }

                const place = await getPlace(newCity);
                if (!place) {
                    await sock.sendMessage(targetJid, { text: `❌ لم يتم العثور على المدينة "${newCity}".` }, { quoted: msg });
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
                    await saveSubscribersToFirebase();

                    await sock.sendMessage(targetJid, { text: `✅ *تم تعديل المدينة بنجاح إلى (${place.name} - ${place.country || ''})!* 🔄` }, { quoted: msg });
                }
            }

            // 4. أمر صلاتي / مواقتي
            else if (cleanText === 'صلاتي' || cleanText === 'مواقتي') {
                const sub = subscribers[targetJid];
                if (!sub) {
                    await sock.sendMessage(targetJid, { text: `غير مشترك حالياً. أرسل *اشتراك اسم_المدينة* للتفعيل.` }, { quoted: msg });
                    return;
                }

                const dateObj = getFormattedDate(sub.timezone);
                const timingsSchedule = formatTimingsSchedule(sub.rawTimings || {}, sub.timezone);

                await sock.sendMessage(targetJid, {
                    text: `🕌 *مواقيت الصلاة* 🌸\n\n📍 *المدينة:* ${sub.cityName} (${sub.country})\n\n${dateObj.fullText}\n\n${timingsSchedule}`
                }, { quoted: msg });
            }

            // 5. أمر إلغاء الاشتراك في المواقيت
            else if (cleanText === 'إلغاء الاشتراك' || cleanText === 'الغاء الاشتراك' || cleanText === 'إلغاء اشتراك' || cleanText === 'الغاء اشتراك') {
                if (subscribers[targetJid]) {
                    delete subscribers[targetJid];
                    await saveSubscribersToFirebase();
                    await sock.sendMessage(targetJid, { text: `🛑 *تم إلغاء الاشتراك في خدمة أوقات الصلاة بنجاح.*` }, { quoted: msg });
                } else {
                    await sock.sendMessage(targetJid, { text: `غير مشترك في الخدمة حالياً.` }, { quoted: msg });
                }
            }

            // 6. أمر المساعدة والأوامر
            else if (cleanText === '.مساعدة' || cleanText === 'مساعدة' || cleanText === 'اوامر' || cleanText === 'الأوامر') {
                await sock.sendMessage(targetJid, {
                    text: `🕌 *بوت التذكير والإشعار الإسلامي الشامل*\n\n• *اشتراك اسم_المدينة* ➔ الاشتراك بمدينة معينة (مثال: اشتراك جازان).\n• *صلاتي* أو *مواقتي* ➔ عرض مواقيت اليوم والتاريخ للمدينة والصلاة القادمة.\n• *تعديل اسم_المدينة* ➔ تغيير المدينة بسهولة.\n• *إلغاء الاشتراك* ➔ لإيقاف استقبال تنبيهات الصلاة.\n• *حديث 2د* أو *حديث 10د* ➔ تفعيل تذكير بالأحاديث والشرح كل عدد دقائق محدد.\n• *ايقاف الحديث* ➔ لإيقاف التذكير الدوري بالأحاديث.\n• *فحص* ➔ للتأكد من جاهزية واستجابة البوت.\n\n⚙️ *أوامر المطور:* \n• *.الاحصائيات* ➔ عرض عدد المشتركين والمدن.\n• *.اذاعة النص* ➔ إرسال رسالة لكل المشتركين والمجموعات.\n• *.تنظيف* ➔ لحذف الجلسات التالفة أو مسح العقد غير المرغوب فيها من Firebase.`
                }, { quoted: msg });
            }

            // 7. أمر فحص الاستجابة
            else if (cleanText === 'فحص' || cleanText === 'تست' || cleanText === 'ping') {
                await sock.sendMessage(targetJid, { text: `✅ البوت شغال ومتصل بنجاح ومربوط بقاعدة بيانات Firebase السحابية!` }, { quoted: msg });
            }

            // 8. أمر الإحصائيات (للمطور)
            else if (cleanText === '.الاحصائيات' || cleanText === 'الاحصائيات' || cleanText === '.إحصائيات') {
                if (!isFromMe) return;

                const count = Object.keys(subscribers).length;
                const hadithCount = Object.keys(hadithSubscribers).length;
                const citiesCount = {};

                for (const sub of Object.values(subscribers)) {
                    citiesCount[sub.cityName] = (citiesCount[sub.cityName] || 0) + 1;
                }

                let cityDetails = Object.entries(citiesCount)
                    .map(([c, n]) => `• ${c}: ${n} مشترك/مجموعة`)
                    .join('\n');

                await sock.sendMessage(targetJid, {
                    text: `📊 *إحصائيات البوت:* \n\n👥 *إجمالي المشتركين بمواقيت الصلاة:* ${count}\n📜 *المشتركين بالأحاديث الدورية:* ${hadithCount}\n\n📍 *التوزيع حسب المدن:*\n${cityDetails || 'لا يوجد مشتركين حتى الآن'}`
                }, { quoted: msg });
            }

            // 9. أمر الإذاعة العامة (للمطور)
            else if (cleanText.startsWith('.اذاعة') || cleanText.startsWith('اذاعة')) {
                if (!isFromMe) return;

                const broadcastText = text.replace(/^(\.اذاعة|اذاعة)/i, '').trim();
                if (!broadcastText) {
                    await sock.sendMessage(targetJid, { text: `❌ يرجى كتابة نص الإذاعة بعد الأمر.` }, { quoted: msg });
                    return;
                }

                const allJids = Array.from(new Set([...Object.keys(subscribers), ...Object.keys(hadithSubscribers)]));
                await sock.sendMessage(targetJid, { text: `📢 جاري بدء الإذاعة لـ (${allJids.length}) مشترك ومجموعة...` }, { quoted: msg });

                let success = 0;
                for (const jid of allJids) {
                    try {
                        await sock.sendMessage(jid, { text: `📢 *تنويه هام من إدارة البوت:*\n\n${broadcastText}` });
                        success++;
                    } catch (e) {}
                }

                await sock.sendMessage(targetJid, { text: `✅ تم إرسال الإذاعة بنجاح إلى (${success}/${allJids.length}) مشترك/مجموعة.` }, { quoted: msg });
            }

        } catch (err) {
            console.log('خطأ معالجة الرسالة:', err.message);
        }
    });
}

startBot();
 
