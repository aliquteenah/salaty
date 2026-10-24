import fs from 'fs';
import path from 'path';
import { toEnDigits, pad, getJson, selfJid } from '../utils/helpers.js';

const REM_FILE = path.join(process.cwd(), 'reminders.json');
let reminders = [];
try { reminders = JSON.parse(fs.readFileSync(REM_FILE, 'utf8')); } catch (e) {}
const saveReminders = () => { try { fs.writeFileSync(REM_FILE, JSON.stringify(reminders)); } catch (e) {} };

const UNIT_MS = {
    'ثانية': 1000, 'ثواني': 1000, 'ث': 1000, s: 1000,
    'دقيقة': 60000, 'دقائق': 60000, 'د': 60000, m: 60000,
    'ساعة': 3600000, 'ساعات': 3600000, 'س': 3600000, h: 3600000,
    'يوم': 86400000, 'ايام': 86400000, 'أيام': 86400000, 'ي': 86400000, d: 86400000
};

function parseReminder(raw) {
    const s = toEnDigits(raw.trim());
    let mt = s.match(/^(\d+)\s*(ثانية|ثواني|دقيقة|دقائق|ساعة|ساعات|يوم|ايام|أيام|ث|د|س|ي|s|m|h|d)\s+([\s\S]+)$/i);
    if (mt) return { ts: Date.now() + Number(mt[1]) * UNIT_MS[mt[2].toLowerCase()], text: mt[3].trim() };

    mt = s.match(/^(\d{1,2}):(\d{2})\s+([\s\S]+)$/);
    if (mt) {
        const d = new Date();
        d.setHours(Number(mt[1]), Number(mt[2]), 0, 0);
        if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
        return { ts: d.getTime(), text: mt[3].trim() };
    }
    return null;
}

const fmtWhen = (ts) => {
    const d = new Date(ts);
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

let loopSock = null;
let loopTimer = null;

export function startReminderLoop(sock) {
    loopSock = sock;
    if (loopTimer) return;
    loopTimer = setInterval(async () => {
        if (!loopSock) return;
        const now = Date.now();
        const due = reminders.filter((r) => r.ts <= now);
        for (const r of due) {
            try {
                await loopSock.sendMessage(selfJid(loopSock), { text: `⏰ *تذكير:*\n${r.text}` });
                reminders = reminders.filter((x) => x.id !== r.id);
                saveReminders();
            } catch (e) {}
        }
    }, 15000);
}

function weatherDesc(code) {
    if (code === 0) return '☀️ صافٍ';
    if (code <= 2) return '⛅ غائم جزئياً';
    if (code === 3) return '☁️ غائم';
    if (code === 45 || code === 48) return '🌫️ ضباب';
    if (code >= 51 && code <= 57) return '🌦️ رذاذ';
    if (code >= 61 && code <= 67) return '🌧️ مطر';
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return '❄️ ثلوج';
    if (code >= 80 && code <= 82) return '🌦️ زخات مطر';
    if (code >= 95) return '⛈️ عاصفة رعدية';
    return '🌡️ غير محدد';
}

export async function weatherText(city) {
    const place = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=ar`).then(j => j.results?.[0]);
    if (!place) return `❌ لم أجد المدينة "${city}"`;

    const j = await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=1`);
    const c = j.current;
    const d = j.daily;
    const r = (n) => Math.round(n);

    return `🌤️ *طقس ${place.name}${place.country ? '، ' + place.country : ''}*\n\n${weatherDesc(c.weather_code)}\n🌡️ الحرارة: ${r(c.temperature_2m)}° (تشعر بـ ${r(c.apparent_temperature)}°)\n🔺 العظمى: ${r(d.temperature_2m_max[0])}° | 🔻 الصغرى: ${r(d.temperature_2m_min[0])}°\n💧 الرطوبة: ${r(c.relative_humidity_2m)}%\n💨 الرياح: ${r(c.wind_speed_10m)} كم/س\n☔ احتمال المطر: ${d.precipitation_probability_max[0] ?? 0}%`;
}

export async function handleRemindersAndWeather(sock, msg, jid, text) {
    const edit = (t) => sock.sendMessage(jid, { text: t, edit: msg.key });

    if (text.startsWith('.ذكرني')) {
        const parsed = parseReminder(text.slice('.ذكرني'.length));
        if (!parsed) return edit('❌ الصيغة: *.ذكرني 30د نص التذكير*\nأو: *.ذكرني 14:30 نص التذكير*');
        reminders.push({ id: `${Date.now()}${Math.floor(Math.random() * 1000)}`, ts: parsed.ts, text: parsed.text });
        saveReminders();
        await edit(`✅ تم ضبط التذكير\n📝 ${parsed.text}\n🕒 ${fmtWhen(parsed.ts)}`);
        return true;
    }

    if (text === '.تذكيراتي') {
        const list = [...reminders].sort((a, b) => a.ts - b.ts);
        if (!list.length) await edit('📭 لا توجد تذكيرات.');
        else {
            const lines = list.map((r, i) => `${i + 1}. ${r.text}\n   🕒 ${fmtWhen(r.ts)}`);
            await edit(`⏰ *تذكيراتك:*\n\n${lines.join('\n\n')}`);
        }
        return true;
    }

    if (text.startsWith('.حذف_تذكير')) {
        const n = parseInt(toEnDigits(text.slice('.حذف_تذكير'.length).trim()), 10);
        const list = [...reminders].sort((a, b) => a.ts - b.ts);
        if (!n || !list[n - 1]) await edit('❌ رقم غير صحيح.');
        else {
            const target = list[n - 1];
            reminders = reminders.filter((r) => r.id !== target.id);
            saveReminders();
            await edit(`🗑️ تم حذف التذكير: ${target.text}`);
        }
        return true;
    }

    if (text === '.طقس' || text.startsWith('.طقس ')) {
        const city = text.slice('.طقس'.length).trim() || 'الرياض';
        await edit('⏳ جاري جلب الطقس...');
        await edit(await weatherText(city));
        return true;
    }

    return false;
}
