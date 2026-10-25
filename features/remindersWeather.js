import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { toEnDigits, pad, selfJid } from '../utils/helpers.js';

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
                const target = r.jid || selfJid(loopSock);
                const card = `╮───────────────╭ـ
│「❥📲 **تنبيه شخصي** 📃❥」
│───────────────╰ـ
*╮ ───═┅─┅─┅═─── ╭*
│⚝ ⃟🎖️❯ ⏰ *تذكير جديد!*
│⚝ ⃟🧰❯ 📝 *المحتوى:* ${r.text}
*╯ ───═┅─┅─┅═─── ╰*`;
                await loopSock.sendMessage(target, { text: card });
                reminders = reminders.filter((x) => x.id !== r.id);
                saveReminders();
            } catch (e) {}
        }
    }, 15000);
}

export async function weatherText(cityName) {
    try {
        const url = `https://wttr.in/${encodeURIComponent(cityName)}?format=j1&lang=ar`;
        const response = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 });

        const data = response.data;
        const current = data.current_condition[0];
        const weatherDesc = current.lang_ar ? current.lang_ar[0].value : current.weatherDesc[0].value;
        const temp = current.temp_C;
        const feelsLike = current.FeelsLikeC;
        const humidity = current.humidity;
        const wind = current.windspeedKmph;

        const today = data.weather[0];
        const maxTemp = today.maxtempC;
        const minTemp = today.mintempC;

        return `╮───────────────╭ـ
│「❥📲 **حالة الطقس** 📃❥」
│───────────────╰ـ
*╮ ───═┅─┅─┅═─── ╭*
│⚝ ⃟🎖️❯ 🌤️ *مدينة:* ${cityName}
│⚝ ⃟🧰❯ 📌 *الحالة:* ${weatherDesc}
│⚝ ⃟⚓❯ 🌡️ *الحرارة:* ${temp}°C (الملموسة: ${feelsLike}°C)
│⚝ ⃟💎❯ 🔺 *العظمى:* ${maxTemp}°C | 🔻 *الصغرى:* ${minTemp}°C
│⚝ ⃟👾❯ 💧 *الرطوبة:* ${humidity}%
│⚝ ⃟🪙❯ 💨 *الرياح:* ${wind} كم/س
*╯ ───═┅─┅─┅═─── ╰*`;

    } catch (e) {
        return `❌ تعذر جلب معلومات الطقس لمدينة "${cityName}" حالياً.`;
    }
}

export async function handleRemindersAndWeather(sock, msg, jid, text) {
    const isRemind = text.startsWith('.ذكرني') || text.startsWith('ذكرني');
    const isList = text === '.تذكيراتي' || text === 'تذكيراتي';
    const isDel = text.startsWith('.حذف_تذكير') || text.startsWith('حذف_تذكير');
    const isWeather = text.startsWith('.طقس') || text.startsWith('طقس');

    if (!(isRemind || isList || isDel || isWeather)) return false;

    if (isRemind) {
        const cleanVal = text.replace(/^(\.ذكرني|ذكرني)/i, '');
        const parsed = parseReminder(cleanVal);
        if (!parsed) {
            await sock.sendMessage(jid, { text: '❌ الصيغة الصحيحة:\n*.ذكرني 30د نص التذكير*\nأو: *.ذكرني 14:30 نص التذكير*' }, { quoted: msg });
            return true;
        }
        reminders.push({ id: `${Date.now()}${Math.floor(Math.random() * 1000)}`, ts: parsed.ts, text: parsed.text, jid });
        saveReminders();

        const card = `╮───────────────╭ـ
│「❥📲 **تم ضبط التذكير** 📃❥」
│───────────────╰ـ
*╮ ───═┅─┅─┅═─── ╭*
│⚝ ⃟🎖️❯ ✅ *تم الضبط بنجاح*
│⚝ ⃟🧰❯ 📝 *التذكير:* ${parsed.text}
│⚝ ⃟⚓❯ 🕒 *الوقت:* ${fmtWhen(parsed.ts)}
*╯ ───═┅─┅─┅═─── ╰*`;

        await sock.sendMessage(jid, { text: card }, { quoted: msg });
        return true;
    }

    if (isList) {
        const list = reminders.filter(r => r.jid === jid).sort((a, b) => a.ts - b.ts);
        if (!list.length) {
            await sock.sendMessage(jid, { text: '📭 لا توجد لديك تذكيرات نشطة حالياً.' }, { quoted: msg });
        } else {
            const lines = list.map((r, i) => `│⚝ ⃟💎❯ ${i + 1}. ${r.text} (${fmtWhen(r.ts)})`).join('\n');
            const card = `╮───────────────╭ـ
│「❥📲 **قائمة تذكيراتك** 📃❥」
│───────────────╰ـ
*╮ ───═┅─┅─┅═─── ╭*
${lines}
*╯ ───═┅─┅─┅═─── ╰*`;
            await sock.sendMessage(jid, { text: card }, { quoted: msg });
        }
        return true;
    }

    if (isDel) {
        const cleanVal = text.replace(/^(\.حذف_تذكير|حذف_تذكير)/i, '').trim();
        const n = parseInt(toEnDigits(cleanVal), 10);
        const list = reminders.filter(r => r.jid === jid).sort((a, b) => a.ts - b.ts);
        if (!n || !list[n - 1]) {
            await sock.sendMessage(jid, { text: '❌ رقم غير صحيح. أرسل *تذكيراتي* لمعرفة الأرقام.' }, { quoted: msg });
        } else {
            const target = list[n - 1];
            reminders = reminders.filter((r) => r.id !== target.id);
            saveReminders();
            await sock.sendMessage(jid, { text: `🗑️ تم حذف التذكير: ${target.text}` }, { quoted: msg });
        }
        return true;
    }

    if (isWeather) {
        const city = text.replace(/^(\.طقس|طقس)/i, '').trim() || 'الرياض';
        const resText = await weatherText(city);
        await sock.sendMessage(jid, { text: resText }, { quoted: msg });
        return true;
    }

    return false;
}
