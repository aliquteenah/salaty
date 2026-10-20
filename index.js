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

// ================== 2. إعدادات المتغيرات وقاعدة البيانات والسحابة ==================
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = "aliquteenah/salaty";
const GITHUB_FILE_PATH = "prayer_subscribers.json";
const AUTH_FILE_PATH = "prayer_bot_auth.json";

const SUBSCRIBERS_FILE = path.join(process.cwd(), 'prayer_subscribers.json');
const AUTH_DIR = path.join(process.cwd(), 'prayer_bot_auth');

if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
}

let subscribers = {};

// مزامنة ورفع أي ملف نصي/بيانات إلى GitHub
async function syncFileToGithub(repoPath, contentString, commitMessage) {
    if (!GITHUB_TOKEN) return;
    try {
        const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${repoPath}`;
        let sha = null;
        const getRes = await fetch(url, {
            headers: {
                "Authorization": `Bearer ${GITHUB_TOKEN}`,
                "Accept": "application/vnd.github.v3+json"
            }
        });

        if (getRes.ok) {
            const fileData = await getRes.json();
            sha = fileData.sha;
        }

        const base64Content = Buffer.from(contentString).toString('base64');
        await fetch(url, {
            method: "PUT",
            headers: {
                "Authorization": `Bearer ${GITHUB_TOKEN}`,
                "Accept": "application/vnd.github.v3+json",
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                message: commitMessage,
                content: base64Content,
                sha: sha || undefined
            })
        });
    } catch (e) {
        console.log(`خطأ المزامنة مع GitHub (${repoPath}):`, e.message);
    }
}

// 1. استرجاع المشتركين من GitHub عند الإقلاع
async function restoreSubscribersFromGithub() {
    if (!GITHUB_TOKEN) return;
    try {
        const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`;
        const res = await fetch(url, {
            headers: {
                "Authorization": `Bearer ${GITHUB_TOKEN}`,
                "Accept": "application/vnd.github.v3+json"
            }
        });

        if (res.ok) {
            const data = await res.json();
            const jsonString = Buffer.from(data.content, 'base64').toString('utf8');
            subscribers = JSON.parse(jsonString);
            fs.writeFileSync(SUBSCRIBERS_FILE, jsonString, 'utf8');
            console.log(`✅ تم استرجاع (${Object.keys(subscribers).length}) مشترك من GitHub بنجاح!`);
        }
    } catch (e) {
        console.log("لم يتم العثور على قائمة مشتركين سابقة في GitHub:", e.message);
    }
}

// 2. استرجاع مجلد الجلسة كاملاً بجميع ملفاته من GitHub عند الإقلاع
async function restoreAuthFromGithub() {
    if (!GITHUB_TOKEN) return;
    try {
        const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${AUTH_FILE_PATH}`;
        const res = await fetch(url, {
            headers: {
                "Authorization": `Bearer ${GITHUB_TOKEN}`,
                "Accept": "application/vnd.github.v3+json"
            }
        });

        if (res.ok) {
            const data = await res.json();
            const jsonString = Buffer.from(data.content, 'base64').toString('utf8');
            const authFiles = JSON.parse(jsonString);

            if (!fs.existsSync(AUTH_DIR)) {
                fs.mkdirSync(AUTH_DIR, { recursive: true });
            }

            for (const [filename, contentBase64] of Object.entries(authFiles)) {
                const fileBuf = Buffer.from(contentBase64, 'base64');
                fs.writeFileSync(path.join(AUTH_DIR, filename), fileBuf);
            }
            console.log("✅ تم استرجاع وترميم ملفات جلسة الواتساب من GitHub بنجاح!");
        }
    } catch (e) {
        console.log("تعذر جلب ملفات الجلسة من GitHub:", e.message);
    }
}

// حفظ ومزامنة كامل ملفات مجلد الجلسة إلى GitHub
async function saveAndSyncAuth() {
    try {
        if (!fs.existsSync(AUTH_DIR)) return;
        const files = fs.readdirSync(AUTH_DIR);
        const authData = {};

        for (const file of files) {
            const filePath = path.join(AUTH_DIR, file);
            if (fs.statSync(filePath).isFile()) {
                const fileBuf = fs.readFileSync(filePath);
                authData[file] = fileBuf.toString('base64');
            }
        }

        await syncFileToGithub(AUTH_FILE_PATH, JSON.stringify(authData), "🔑 حفظ وتحديث جلسة الواتساب");
    } catch (e) {
        console.log("خطأ حفظ الجلسة على GitHub:", e.message);
    }
}

// حفظ ومزامنة المشتركين
async function saveAndSyncSubscribers() {
    const contentString = JSON.stringify(subscribers, null, 2);
    fs.writeFileSync(SUBSCRIBERS_FILE, contentString);
    await syncFileToGithub(GITHUB_FILE_PATH, contentString, "🔄 التحديث التلقائي لملف المشتركين");
}

// ================== 3. الأدعية والأحاديث والتوقيت ==================
const HADITH_LIST = [
    { hadith: "«إِنَّ الصَّلَاةَ كَانَتْ عَلَى الْمُؤْمِنِينَ كِتَابًا مَوْقُوتًا»", source: "سورة النساء - آية 103" },
    { hadith: "«بُنِيَ الإِسْلاَمُ عَلَى خَمْسٍ: شَهَادَةِ أَنْ لاَ إِلَهَ إِلاَّ اللَّهُ وَأَنَّ مُحَمَّدًا رَسُولُ اللَّهِ، وَإِقَامِ الصَّلاَةِ، وَإِيتَاءِ الزَّكَاةِ، وَالحَجِّ، وَصَوْمِ رَمَضَانَ»", source: "صحيح البخاري" },
    { hadith: "«سُئِلَ النَّبِيُّ ﷺ: أَيُّ الأَعْمَالِ أَفْضَلُ؟ قَالَ: الصَّلاَةُ لِوَقْتِهَا»", source: "متفق عليه" },
    { hadith: "«مَنْ صَلَّى الْبَرْدَيْنِ دَخَلَ الْجَنَّةَ»", source: "صحيح البخاري (البردين: الفجر والعصر)" }
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

async function getPlace(cityName) {
    try {
        const j = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=5&language=ar`);
        if (!j.results || j.results.length === 0) return null;
        
        const exactMatch = j.results.find(r => r.feature_code && r.feature_code.startsWith('PPLC')) || j.results[0];
        return exactMatch;
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
                        await saveAndSyncSubscribers();
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

                // أذكار الصباح (بعد الفجر بـ 20 دقيقة)
                if (rawTimings['Fajr']) {
                    const [fH, fM] = rawTimings['Fajr'].split(' ')[0].split(':').map(Number);
                    const morningAzkarMin = fH * 60 + fM + 20;
                    const keyMorningAzkar = `${jid}_${todayDateStr}_morning_azkar`;
                    if (currentTotalMin === morningAzkarMin && !sentReminders.has(keyMorningAzkar)) {
                        sentReminders.add(keyMorningAzkar);
                        await sock.sendMessage(jid, {
                            text: `🌅 *تذكير بأذكار الصباح* 🌸\n\nاصبحنا واصبح الملك لله والحمد لله.. لا تنسَ قراءة أذكار الصباح لتحفظك وتنوّر يومك ✨\n\n«أَلا بِذِكْرِ اللَّهِ تَطْمَئِنُّ الْقُلُوبُ»`
                        });
                    }
                }

                // أذكار المساء (بعد العصر بـ 20 دقيقة)
                if (rawTimings['Asr']) {
                    const [aH, aM] = rawTimings['Asr'].split(' ')[0].split(':').map(Number);
                    const eveningAzkarMin = aH * 60 + aM + 20;
                    const keyEveningAzkar = `${jid}_${todayDateStr}_evening_azkar`;
                    if (currentTotalMin === eveningAzkarMin && !sentReminders.has(keyEveningAzkar)) {
                        sentReminders.add(keyEveningAzkar);
                        await sock.sendMessage(jid, {
                            text: ``🌆 *تذكير بأذكار المساء* 🌙\n\nأمسينا وأمسى الملك لله.. حان وقت حصنك اليومي بقراءة أذكار المساء 🤍`
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
    // استعادة الجلسة والمشتركين من GitHub فور الإقلاع
    await restoreAuthFromGithub();
    await restoreSubscribersFromGithub();

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
        await saveAndSyncAuth();
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
            console.log('✅ تم تسجيل الدخول بنجاح! تم استرجاع ومزامنة الجلسة والمشتركين مع GitHub.');
            await saveAndSyncAuth();
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

            // 1. أمر الاشتراك
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
                    await saveAndSyncSubscribers();

                    const dateObj = getFormattedDate(tz);
                    const timingsSchedule = formatTimingsSchedule(rawTimings, tz);

                    await sock.sendMessage(targetJid, {
                        text: `✅ *تم اشتراكك بنجاح!* ✨\n\n📍 *المدينة:* ${place.name} (${place.country || ''})\n\n${dateObj.fullText}\n\n${timingsSchedule}\n\n───────────────\n${getRandomHadith()}`
                    }, { quoted: msg });
                }
            }

            // 2. أمر تعديل المدينة
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
                    await saveAndSyncSubscribers();

                    await sock.sendMessage(targetJid, { text: `✅ *تم تعديل مدينتك بنجاح إلى (${place.name} - ${place.country || ''})!* 🔄` }, { quoted: msg });
                }
            }

            // 3. أمر صلاتي / مواقتي
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

            // 4. أمر إلغاء الاشتراك
            else if (cleanText === 'إلغاء الاشتراك' || cleanText === 'الغاء الاشتراك' || cleanText === 'إلغاء اشتراك' || cleanText === 'الغاء اشتراك') {
                if (subscribers[targetJid]) {
                    delete subscribers[targetJid];
                    await saveAndSyncSubscribers();
                    await sock.sendMessage(targetJid, { text: `🛑 *تم إلغاء اشتراكك في خدمة أوقات الصلاة بنجاح.*` }, { quoted: msg });
                } else {
                    await sock.sendMessage(targetJid, { text: `أنت غير مشترك في الخدمة حالياً.` }, { quoted: msg });
                }
            }

            // 5. أمر المساعدة والأوامر
            else if (cleanText === '.مساعدة' || cleanText === 'مساعدة' || cleanText === 'اوامر' || cleanText === 'الأوامر') {
                await sock.sendMessage(targetJid, {
                    text: `🕌 *بوت التذكير والإشعار الإسلامي الشامل*\n\n• *اشتراك اسم_المدينة* ➔ الاشتراك بمدينة معينة (مثال: اشتراك جازان).\n• *صلاتي* أو *مواقتي* ➔ عرض مواقيت اليوم والتاريخ لمدينتك والصلاة القادمة.\n• *تعديل اسم_المدينة* ➔ تغيير مدينتك بسهولة.\n• *إلغاء الاشتراك* ➔ لإيقاف استقبال التذكيرات.\n• *فحص* ➔ للتأكد من جاهزية واستجابة البوت.\n\n⚙️ *أوامر المطور:* \n• *.الاحصائيات* ➔ عرض عدد المشتركين والمدن.\n• *.اذاعة النص* ➔ إرسال رسالة لكل المشتركين.`
                }, { quoted: msg });
            }

            // 6. أمر فحص الاستجابة
            else if (cleanText === 'فحص' || cleanText === 'تست' || cleanText === 'ping') {
                await sock.sendMessage(targetJid, { text: `✅ البوت شغال ومتصل بنجاح على منصة Render ومربوط بالسحابة!` }, { quoted: msg });
            }

            // 7. أمر الإحصائيات
            else if (cleanText === '.الاحصائيات' || cleanText === 'الاحصائيات' || cleanText === '.إحصائيات') {
                if (!isFromMe) return;

                const count = Object.keys(subscribers).length;
                const citiesCount = {};

                for (const sub of Object.values(subscribers)) {
                    citiesCount[sub.cityName] = (citiesCount[sub.cityName] || 0) + 1;
                }

                let cityDetails = Object.entries(citiesCount)
                    .map(([c, n]) => `• ${c}: ${n} مشترك`)
                    .join('\n');

                await sock.sendMessage(targetJid, {
                    text: `📊 *إحصائيات البوت:* \n\n👥 *إجمالي المشتركين:* ${count}\n\n📍 *التوزيع حسب المدن:*\n${cityDetails || 'لا يوجد مشتركين حتى الآن'}`
                }, { quoted: msg });
            }

            // 8. أمر الإذاعة العامة
            else if (cleanText.startsWith('.اذاعة') || cleanText.startsWith('اذاعة')) {
                if (!isFromMe) return;

                const broadcastText = text.replace(/^(\.اذاعة|اذاعة)/i, '').trim();
                if (!broadcastText) {
                    await sock.sendMessage(targetJid, { text: `❌ يرجى كتابة نص الإذاعة بعد الأمر.` }, { quoted: msg });
                    return;
                }

                const allJids = Object.keys(subscribers);
                await sock.sendMessage(targetJid, { text: `📢 جاري بدء الإذاعة لـ (${allJids.length}) مشترك...` }, { quoted: msg });

                let success = 0;
                for (const jid of allJids) {
                    try {
                        await sock.sendMessage(jid, { text: `📢 *تنويه هام من إدارة البوت:*\n\n${broadcastText}` });
                        success++;
                    } catch (e) {}
                }

                await sock.sendMessage(targetJid, { text: `✅ تم إرسال الإذاعة بنجاح إلى (${success}/${allJids.length}) مشترك.` }, { quoted: msg });
            }

        } catch (err) {
            console.log('خطأ معالجة الرسالة:', err.message);
        }
    });
}

startBot();
 
