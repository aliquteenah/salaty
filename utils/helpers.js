import fetch from 'node-fetch';

export const pad = (n) => String(n).padStart(2, '0');
export const toEnDigits = (s) => s.replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));

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
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
}

export function unwrap(message) {
    let cur = message;
    for (let i = 0; i < 5 && cur; i++) {
        const inner =
            cur.ephemeralMessage?.message ||
            cur.viewOnceMessage?.message ||
            cur.viewOnceMessageV2?.message ||
            cur.viewOnceMessageV2Extension?.message ||
            cur.documentWithCaptionMessage?.message ||
            cur.editedMessage?.message;
        if (!inner) break;
        cur = inner;
    }
    return cur;
}

export const getType = (c) => Object.keys(c || {}).find((k) => k !== 'messageContextInfo' && k !== 'senderKeyDistributionMessage');
export const getText = (c) => c?.conversation || c?.extendedTextMessage?.text || null;
export const selfJid = (sock) => sock.user.id.split(':')[0] + '@s.whatsapp.net';
