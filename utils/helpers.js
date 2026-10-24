import fetch from 'node-fetch';

export const pad = (n) => String(n).padStart(2, '0');

export function parseTimeToMinutes(timeStr) {
    if (!timeStr) return null;
    const cleanTime = timeStr.trim().split(' ')[0];
    const parts = cleanTime.split(':');
    if (parts.length < 2) return null;
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    return (isNaN(h) || isNaN(m)) ? null : h * 60 + m;
}

export function fmt12(timeStr) {
    if (!timeStr) return '--:--';
    const cleanTime = timeStr.trim().split(' ')[0];
    const [h, mi] = cleanTime.split(':').map(Number);
    if (isNaN(h) || isNaN(mi)) return '--:--';
    return `${h % 12 || 12}:${pad(mi)} ${h >= 12 ? 'م' : 'ص'}`;
}

export function fmtDur(min) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (h > 0 && m > 0) return `${h} ساعة و ${m} دقيقة`;
    return h > 0 ? `${h} ساعة` : `${m} دقيقة`;
}

export function getFormattedDate(timeZone) {
    const date = new Date();
    const dayName = new Intl.DateTimeFormat('ar-SA', { weekday: 'long', timeZone }).format(date);
    const gregorian = new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'long', year: 'numeric', timeZone }).format(date);
    const hijri = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone }).format(date);
    return { fullText: `📅 *اليوم:* ${dayName}\n📆 *التاريخ الميلادي:* ${gregorian}\n🌙 *التاريخ الهجري:* ${hijri} هـ`, dayName };
}

export async function getJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
}
