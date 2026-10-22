import express from 'express';
import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import fetch from 'node-fetch';
import ffmpeg from 'fluent-ffmpeg';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set, get, child, remove } from 'firebase/database';

// ================== 1. خادم Web وميزة منع الخمول ==================
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('🕌 البوت الشامل يعمل بنجاح ومربوط بـ Firebase!');
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
let hadithSubscribers = {};
const quranState = {};
const quranTimers = {};

async function restoreSubscribersFromFirebase() {
    try {
        const dbRef = ref(db);
        const snapshot = await get(child(dbRef, 'subscribers'));
        if (snapshot.exists()) {
            subscribers = snapshot.val() || {};
        }
        
        const hadithSnap = await get(child(dbRef, 'hadith_subscribers'));
        if (hadithSnap.exists()) {
            hadithSubscribers = hadithSnap.val() || {};
        }
    } catch (e) {
        console.log("❌ خطأ جلب المشتركين من Firebase:", e.message);
    }
}

async function saveSubscribersToFirebase() {
    try {
        await set(ref(db, 'subscribers'), subscribers);
        await set(ref(db, 'hadith_subscribers'), hadithSubscribers);
    } catch (e) {
        console.log("❌ خطأ حفظ المشتركين في Firebase:", e.message);
    }
}

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
        }
    } catch (e) {
        console.log("❌ خطأ استرجاع الجلسة من Firebase:", e.message);
    }
}

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

// ================== 3. إعدادات وقائمة القراء الصوتية ==================
const RECITERS = [
    { id: 1, name: 'مشاري العفاسي', edition: 'ar.alafasy' },
    { id: 2, name: 'عبد الباسط عبد الصمد (مرتل)', edition: 'ar.abdulbasitmurattal' },
    { id: 3, name: 'محمود خليل الحصري', edition: 'ar.husary' },
    { id: 4, name: 'سعود الشريم', edition: 'ar.saoodshuraym' },
    { id: 5, name: 'أحمد بن علي العجمي', edition: 'ar.ahmedajamy' },
    { id: 6, name: 'ماهر المعيقلي', edition: 'ar.mahermuaiqly' },
    { id: 7, name: 'عبد الرحمن السديس', edition: 'ar.abdurrahmansudais' },
    { id: 8, name: 'محمد صديق المنشاوي (مرتل)', edition: 'ar.minshawi' },
    { id: 9, name: 'سعد الغامدي', edition: 'ar.ghamadi' },
    { id: 10, name: 'أبو بكر الشاطري', edition: 'ar.shaatree' },
    { id: 11, name: 'ياسر الدوسري', edition: 'ar.yasserdosussary' },
    { id: 12, name: 'ناصر القطامي', edition: 'ar.naserqatami' },
    { id: 13, name: 'محمد أيوب', edition: 'ar.muhammadayyoub' },
    { id: 14, name: 'عبد الله جهني', edition: 'ar.abdullahbasfar' },
    { id: 15, name: 'علي الحذيفي', edition: 'ar.hudhaify' },
    { id: 16, name: 'محمود علي البنا', edition: 'ar.mahmoudalibanna' },
    { id: 17, name: 'صلاح بو خاطر', edition: 'ar.salahbukhatir' },
    { id: 18, name: 'محمد المحيسني', edition: 'ar.muhammadalmuhasny' },
    { id: 19, name: 'هاني الرفاعي', edition: 'ar.hanirifai' },
    { id: 20, name: 'مصطفى إسماعيل', edition: 'ar.mustafaismail' }
];

function convertMp3ToOggOpus(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .toFormat('ogg')
            .audioCodec('libopus')
            .on('end', () => resolve(outputPath))
            .on('error', (err) => reject(err))
            .save(outputPath);
    });
}

async function sendAyahAndAudio(sock, from, reciter, surahNum = null, ayahNum = null) {
    let url = '';
    if (surahNum && ayahNum) {
        url = `https://api.alquran.cloud/v1/ayah/${surahNum}:${ayahNum}/${reciter.edition}`;
    } else {
        const randomAyah = Math.floor(Math.random() * 6236) + 1;
        url = `https://api.alquran.cloud/v1/ayah/${randomAyah}/${reciter.edition}`;
    }
    
    const tempMp3Path = path.join(process.cwd(), `temp_${Date.now()}_${Math.floor(Math.random() * 1000)}.mp3`);
    const tempOggPath = path.join(process.cwd(), `temp_${Date.now()}_${Math.floor(Math.random() * 1000)}.ogg`);

    try {
        const response = await axios.get(url);
        if (!response.data || !response.data.data) {
            await sock.sendMessage(from, { text: '❌ تعذر العثور على الآية المطلوبة، يرجى التأكد من رقم السورة والآية.' });
            return;
        }

        const data = response.data.data;
        const caption = `📖 *سورة ${data.surah.name} - الآية (${data.numberInSurah})*\n🎙️ *القارئ:* ${reciter.name}\n\n﴿ ${data.text} ﴾`;
        const audioUrl = data.audio;

        await sock.sendMessage(from, { text: caption });

        const audioResponse = await axios({
            method: 'get',
            url: audioUrl,
            responseType: 'arraybuffer'
        });
        fs.writeFileSync(tempMp3Path, audioResponse.data);

        try {
            await convertMp3ToOggOpus(tempMp3Path, tempOggPath);
            await sock.sendMessage(from, { 
                audio: fs.readFileSync(tempOggPath), 
                mimetype: 'audio/ogg; codecs=opus',
                ptt: true
            });
        } catch (e) {
            await sock.sendMessage(from, { 
                audio: fs.readFileSync(tempMp3Path), 
                mimetype: 'audio/mp4',
                ptt: false
            });
        }

    } catch (err) {
        console.error('خطأ أثناء إرسال صوت القرآن:', err.message);
        await sock.sendMessage(from, { text: '❌ حدث خطأ أثناء جلب الآية، يرجى التأكد من الأرقام المدخلة.' });
    } finally {
        if (fs.existsSync(tempMp3Path)) fs.unlinkSync(tempMp3Path);
        if (fs.existsSync(tempOggPath)) fs.unlinkSync(tempOggPath);
    }
}

// ================== 4. الأدعية والأحاديث والتوقيت المحسن ==================
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

async function getRandomHadith() {
    try {
        const categories = [2, 3, 4, 5]; 
        const randomCat = getRandomItem(categories);

        const res = await fetch(`https://hadeethenc.com/api/v1/hadeeths/list/?language=ar&category_id=${randomCat}&page=1&per_page=20`);

        if (res.ok) {
            const data = await res.json();
            if (data && data.data && data.data.length > 0) {
                const randomItem = getRandomItem(data.data);
                
                const detailRes = await fetch(`https://hadeethenc.com/api/v1/hadeeths/one/?language=ar&id=${randomItem.id}`);

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

async function getHadithWithExplanationOnly() {
    try {
        const categories = [2, 3, 4, 5];
        const randomCat = getRandomItem(categories);

        const res = await fetch(`https://hadeethenc.com/api/v1/hadeeths/list/?language=ar&category_id=${randomCat}&page=1&per_page=25`);

        if (res.ok) {
            const data = await res.json();
            if (data && data.data && data.data.length > 0) {
                const randomItem = getRandomItem(data.data);

                const detailRes = await fetch(`https://hadeethenc.com/api/v1/hadeeths/one/?language=ar&id=${randomItem.id}`);

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

function parseTimeToMinutes(timeStr) {
    if (!timeStr) return null;
    const cleanTime = timeStr.trim().split(' ')[0];
    const parts = cleanTime.split(':');
    if (parts.length < 2) return null;
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (isNaN(h) || isNaN(m)) return null;
    return h * 60 + m;
}

function fmt12(timeStr) {
    if (!timeStr) return '--:--';
    const cleanTime = timeStr.trim().split(' ')[0];
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
    const nowMin = parseTimeToMinutes(nowStr) || 0;

    const names = { Fajr: 'الفجر', Dhuhr: 'الظهر', Asr: 'العصر', Maghrib: 'المغرب', Isha: 'العشاء' };
    const order = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];

    let nextKey = order.find((k) => {
        const pMin = parseTimeToMinutes(rawTimings?.[k]);
        return pMin !== null && pMin > nowMin;
    });

    let diffMin = 0;
    if (nextKey && rawTimings?.[nextKey]) {
        const pMin = parseTimeToMinutes(rawTimings[nextKey]);
        diffMin = pMin - nowMin;
    } else {
        nextKey = 'Fajr';
        const fajrMin = parseTimeToMinutes(rawTimings?.Fajr);
        if (fajrMin !== null) {
            diffMin = 1440 - nowMin + fajrMin;
        }
    }

    const nextName = names[nextKey] || 'الفجر';
    return `⏳ القادمة: *${nextName}* بعد ${fmtDur(diffMin)}`;
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
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
}

async function getPlace(cityName) {
    try {
        const cleanName = cityName.trim().toLowerCase();

        const knownCities = {
            'الخرطوم': { name: 'الخرطوم', country: 'السودان', latitude: 15.5007, longitude: 32.5599, timezone: 'Africa/Khartoum' },
            'خرطوم': { name: 'الخرطوم', country: 'السودان', latitude: 15.5007, longitude: 32.5599, timezone: 'Africa/Khartoum' },
            'khartoum': { name: 'الخرطوم', country: 'السودان', latitude: 15.5007, longitude: 32.5599, timezone: 'Africa/Khartoum' }
        };

        if (knownCities[cleanName]) {
            return knownCities[cleanName];
        }

        const j = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=10&language=ar`);
        if (!j.results || j.results.length === 0) return null;

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

// ================== 5. محرك التنبيهات الدورية الدقيق ==================
const sentReminders = new Set();

function startPrayerCheckLoop(sock) {
    setInterval(async () => {
        const now = new Date();
        const nowMs = Date.now();

        // فحص تذكيرات الأحاديث
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

        // فحص تنبيهات الصلاة وأذكار الفجر
        for (const [jid, info] of Object.entries(subscribers)) {
            try {
                const tz = info.timezone;
                if (!tz) continue;

                const localTimeStr = now.toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
                const currentTotalMin = parseTimeToMinutes(localTimeStr);
                if (currentTotalMin === null) continue;

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
                    const prayerTotalMin = parseTimeToMinutes(rawTimings[item.key]);
                    if (prayerTotalMin === null) continue;

                    const minBefore30 = prayerTotalMin - 30;
                    const key30 = `${jid}_${todayDateStr}_${prayerName}_30min`;
                    if (currentTotalMin === minBefore30 && !sentReminders.has(key30)) {
                        sentReminders.add(key30);
                        await sock.sendMessage(jid, {
                            text: `⏳ *تنبيه: قرب صلاة ${prayerName}* 🕌\n\n${dateObj.fullText}\n\nتبقّى 30 دقيقة على أذان صلاة *${prayerName}* في مدينة *${info.cityName}* (${info.country}).\n\n✨ _جهز نفسك للصلاة وتهيأ للوضوء_\n\n───────────────\n${hadithText}`
                        });
                    }

                    const keyExact = `${jid}_${todayDateStr}_${prayerName}_exact`;
                    if (currentTotalMin === prayerTotalMin && !sentReminders.has(keyExact)) {
                        sentReminders.add(keyExact);
                        await sock.sendMessage(jid, {
                            text: `🕌 *حان الآن أذان صلاة ${prayerName}* 🌸\n\n${dateObj.fullText}\n\nحان الآن موعد أذان صلاة *${prayerName}* حسب التوقيت المحلي لمدينة *${info.cityName}* (${info.country}).\n\n✨ _حيّ على الصلاة.. حيّ على الفلاح_\n\n───────────────\n${hadithText}`
                        });
                    }

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

                if (rawTimings['Fajr']) {
                    const fMin = parseTimeToMinutes(rawTimings['Fajr']);
                    if (fMin !== null) {
                        const morningAzkarMin = fMin + 20;
                        const keyMorningAzkar = `${jid}_${todayDateStr}_morning_azkar`;
                        if (currentTotalMin === morningAzkarMin && !sentReminders.has(keyMorningAzkar)) {
                            sentReminders.add(keyMorningAzkar);
                            await sock.sendMessage(jid, {
                                text: `🌅 *تذكير بأذكار الصباح* 🌸\n\nأصبحنا وأصبح الملك لله والحمد لله.. لا تنسَ قراءة أذكار الصباح لتحفظك وتنوّر يومك ✨\n\n«أَلا بِذِكْرِ اللَّهِ تَطْمَئِنُّ الْقُلُوبُ»`
                            });
                        }
                    }
                }

                if (rawTimings['Asr']) {
                    const aMin = parseTimeToMinutes(rawTimings['Asr']);
                    if (aMin !== null) {
                        const eveningAzkarMin = aMin + 20;
                        const keyEveningAzkar = `${jid}_${todayDateStr}_evening_azkar`;
                        if (currentTotalMin === eveningAzkarMin && !sentReminders.has(keyEveningAzkar)) {
                            sentReminders.add(keyEveningAzkar);
                            await sock.sendMessage(jid, {
                                text: ``🌆 *تذكير بأذكار المساء* 🌙\n\nأمسينا وأمسى الملك لله.. حان وقت حصنك اليومي بقراءة أذكار المساء 🤍`
                            });
                        }
                    }
                }

            } catch (err) {
                console.log(`خطأ التذكير لـ ${jid}:`, err.message);
            }
        }

        if (sentReminders.size > 1000) sentReminders.clear();

    }, 30 * 1000);
}

// ================== 6. تشغيل الواتساب والمعالجة الشاملة ==================
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

            // 1. أمر إيقاف الحديث مخصص
            if (cleanText === 'ايقاف الحديث' || cleanText === 'إيقاف الحديث' || cleanText === 'الغاء الحديث' || cleanText === 'إلغاء الحديث') {
                if (hadithSubscribers[targetJid]) {
                    delete hadithSubscribers[targetJid];
                    await saveSubscribersToFirebase();
                    await sock.sendMessage(targetJid, { text: `🛑 *تم إيقاف التذكير الدوري بالأحاديث بنجاح.*` }, { quoted: msg });
                } else {
                    await sock.sendMessage(targetJid, { text: `ℹ️ لا يوجد تذكير دوري بالأحاديث مفعّل لديك حالياً.` }, { quoted: msg });
                }
                return;
            }

            // 2. أمر إيقاف القرآن مخصص
            if (cleanText === 'ايقاف القران' || cleanText === 'إيقاف القرآن' || cleanText === 'إيقاف القران' || cleanText === 'الغاء القران' || cleanText === 'إلغاء القرآن') {
                if (quranTimers[targetJid]) {
                    clearInterval(quranTimers[targetJid]);
                    delete quranTimers[targetJid];
                    await sock.sendMessage(targetJid, { text: `🛑 *تم إيقاف الإرسال التلقائي للقرآن الصوتي بنجاح.*` }, { quoted: msg });
                } else {
                    await sock.sendMessage(targetJid, { text: `ℹ️ لا يوجد إرسال تلقائي للقرآن الصوتي مفعّل لديك حالياً.` }, { quoted: msg });
                }
                return;
            }

            // 3. أمر إيقاف عام لشامل الخدمتين
            if (cleanText === 'إيقاف' || cleanText === 'ايقاف') {
                let stoppedAny = false;

                if (quranTimers[targetJid]) {
                    clearInterval(quranTimers[targetJid]);
                    delete quranTimers[targetJid];
                    stoppedAny = true;
                }

                if (hadithSubscribers[targetJid]) {
                    delete hadithSubscribers[targetJid];
                    await saveSubscribersToFirebase();
                    stoppedAny = true;
                }

                if (stoppedAny) {
                    await sock.sendMessage(targetJid, { text: '🛑 تم إيقاف جميع التذكيرات التلقائية (الأحاديث والقرآن الصوتي) بنجاح.' }, { quoted: msg });
                } else {
                    await sock.sendMessage(targetJid, { text: 'ℹ️ لا يوجد تذكير تلقائي مفعّل لديك حالياً.' }, { quoted: msg });
                }
                return;
            }

            // عرض قائمة القراء والقرآن الصوتي
            if (cleanText === 'صوت' || cleanText === 'قرآن' || cleanText === 'قران' || cleanText === 'آية' || cleanText === 'ايه') {
                let menuText = "🎧 *اختر القارئ المفضل وطريقة الإرسال:*\n\n";
                RECITERS.forEach(r => {
                    menuText += `*[ ${r.id} ]* ${r.name}\n`;
                });
                menuText += "\n📌 *طرق الإرسال:*\n";
                menuText += "1️⃣ لإرسال آية عشوائية واحدة: اكتب رقم القارئ فقط (مثال: `1`).\n";
                menuText += "2️⃣ لإرسال آية محددة نص وصوت: اكتب رقم القارئ ثم رقم السورة ثم رقم الآية (مثال: `13 2 255` لآية الكرسي بصوت محمد أيوب).\n";
                menuText += "3️⃣ للإرسال التلقائي المكرر: اكتب رقم القارئ ثم مسافة ثم الدقائق مع حرف د (مثال: `1 2د` أو `5 10د`).\n\n";
                menuText += "🛑 لإيقاف تكرار القرآن فقط أرسل: *إيقاف القرآن*\n";
                menuText += "🛑 لإيقاف تكرار الحديث فقط أرسل: *إيقاف الحديث*";

                quranState[targetJid] = { step: 'WAITING_FOR_RECITER' };
                await sock.sendMessage(targetJid, { text: menuText }, { quoted: msg });
                return;
            }

            // اختيار القارئ والتلاوة
            if (quranState[targetJid] && quranState[targetJid].step === 'WAITING_FOR_RECITER') {
                const tripleMatch = text.match(/^(\d+)\s+(\d+)\s+(\d+)$/);
                const repeatMatch = text.match(/^(\d+)(?:\s+(\d+)د)?$/i);

                if (tripleMatch) {
                    const selectedId = parseInt(tripleMatch[1], 10);
                    const surahNum = parseInt(tripleMatch[2], 10);
                    const ayahNum = parseInt(tripleMatch[3], 10);
                    const reciter = RECITERS.find(r => r.id === selectedId);

                    if (reciter) {
                        await sock.sendMessage(targetJid, { text: `⏳ جاري جلب سورة رقم (${surahNum}) الآية (${ayahNum}) بصوت *${reciter.name}*...` }, { quoted: msg });
                        await sendAyahAndAudio(sock, targetJid, reciter, surahNum, ayahNum);
                        delete quranState[targetJid];
                        return;
                    } else {
                        await sock.sendMessage(targetJid, { text: '❌ رقم قارئ غير صحيح، يرجى اختيار رقم من القائمة.' }, { quoted: msg });
                        return;
                    }
                }
                else if (repeatMatch) {
                    const selectedId = parseInt(repeatMatch[1], 10);
                    const minutes = repeatMatch[2] ? parseInt(repeatMatch[2], 10) : null;
                    const reciter = RECITERS.find(r => r.id === selectedId);

                    if (reciter) {
                        if (quranTimers[targetJid]) {
                            clearInterval(quranTimers[targetJid]);
                            delete quranTimers[targetJid];
                        }

                        if (minutes && minutes > 0) {
                            await sock.sendMessage(targetJid, { 
                                text: `⏱️ تم تفعيل الإرسال التلقائي بصوت *${reciter.name}* كل *${minutes}* دقيقة.\n\n🛑 لإيقاف التلاوات أرسل: *إيقاف القرآن*` 
                            }, { quoted: msg });

                            await sendAyahAndAudio(sock, targetJid, reciter);

                            quranTimers[targetJid] = setInterval(async () => {
                                await sendAyahAndAudio(sock, targetJid, reciter);
                            }, minutes * 60 * 1000);

                        } else {
                            await sock.sendMessage(targetJid, { text: `⏳ جاري جلب التلاوة بصوت *${reciter.name}*...` }, { quoted: msg });
                            await sendAyahAndAudio(sock, targetJid, reciter);
                        }

                        delete quranState[targetJid];
                        return;
                    } else {
                        await sock.sendMessage(targetJid, { text: '❌ رقم قارئ غير صحيح، يرجى اختيار رقم من القائمة.' }, { quoted: msg });
                        return;
                    }
                }
            }

            // أوامر المطورين والأدوات الخاصة بقواعد البيانات
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
                        text: `✅ *تم تفعيل التذكير الدوري بالأحاديث الشريفة!*\n\nسيتم إرسال حديث نبوي شريف مع الشرح كل *${mins} دقيقة* تلقائياً. 📜✨\n\n_لإيقاف التذكير بالأحاديث في أي وقت أرسل:_ *إيقاف الحديث*`
                    }, { quoted: msg });

                    const firstHadith = await getHadithWithExplanationOnly();
                    await sock.sendMessage(targetJid, { text: firstHadith });
                    return;
                }
            }

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

            else if (cleanText === 'إلغاء الاشتراك' || cleanText === 'الغاء الاشتراك' || cleanText === 'إلغاء اشتراك' || cleanText === 'الغاء اشتراك') {
                if (subscribers[targetJid]) {
                    delete subscribers[targetJid];
                    await saveSubscribersToFirebase();
                    await sock.sendMessage(targetJid, { text: `🛑 *تم إلغاء الاشتراك في خدمة أوقات الصلاة بنجاح.*` }, { quoted: msg });
                } else {
                    await sock.sendMessage(targetJid, { text: `غير مشترك في الخدمة حالياً.` }, { quoted: msg });
                }
            }

            else if (cleanText === '.مساعدة' || cleanText === 'مساعدة' || cleanText === 'اوامر' || cleanText === 'الأوامر') {
                await sock.sendMessage(targetJid, {
                    text: `🕌 *بوت التذكير والإشعار الإسلامي الشامل*\n\n• *اشتراك اسم_المدينة* ➔ الاشتراك بمواقيت الصلاة.\n• *صلاتي* أو *مواقتي* ➔ عرض جدول أوقات اليوم.\n• *صوت* أو *قرآن* ➔ اختيار قارئ وسماع آيات قرآنية (عشوائية، أو محددة بمثال: \`13 2 255\`, أو مكررة).\n• *حديث 2د* ➔ تفعيل تذكير بالأحاديث والشرح كل عدد دقائق محدد.\n• *إيقاف القرآن* ➔ إيقاف الإرسال التلقائي للتلاوات الصوتية فقط.\n• *إيقاف الحديث* ➔ إيقاف التذكير التلقائي بالأحاديث فقط.\n• *إيقاف* ➔ إيقاف كافة التكرارات التلقائية معاً.\n• *فحص* ➔ للتأكد من حالة اتصال البوت.\n\n⚙️ *أوامر المطور:* \n• *.الاحصائيات* ➔ عرض عدد المشتركين والمدن.\n• *.اذاعة النص* ➔ إرسال رسالة لجميع المشتركين والمجموعات.\n• *.تنظيف* ➔ لحذف الجلسات أو مسح البيانات القديمة.`
                }, { quoted: msg });
            }

            else if (cleanText === 'فحص' || cleanText === 'تست' || cleanText === 'ping') {
                await sock.sendMessage(targetJid, { text: `✅ البوت شغال ومتصل بنجاح ومربوط بقاعدة بيانات Firebase السحابية!` }, { quoted: msg });
            }

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
 
