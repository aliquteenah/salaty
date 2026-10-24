import { getJson, fmt12, fmtDur, parseTimeToMinutes, getFormattedDate } from '../utils/helpers.js';
import { getRandomHadith, getRandomItem, BETWEEN_AZAN_IQAMA_DUAS, getHadithWithExplanationOnly } from './hadith.js';
import { saveSubscribersToFirebase } from '../config/firebase.js';

export async function getPlace(cityName) {
    try {
        const cleanName = cityName.trim().toLowerCase();
        const knownCities = {
            'الخرطوم': { name: 'الخرطوم', country: 'السودان', latitude: 15.5007, longitude: 32.5599, timezone: 'Africa/Khartoum' },
            'khartoum': { name: 'الخرطوم', country: 'السودان', latitude: 15.5007, longitude: 32.5599, timezone: 'Africa/Khartoum' }
        };

        if (knownCities[cleanName]) return knownCities[cleanName];

        const j = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=10&language=ar`);
        if (!j.results || j.results.length === 0) return null;

        return j.results.find(r => r.feature_code === 'PPLC') || j.results.find(r => r.feature_code?.startsWith('PPLA')) || j.results[0];
    } catch (e) { return null; }
}

export async function getPrayerTimings(lat, lng, timezone) {
    try {
        const j = await getJson(`https://api.aladhan.com/v1/timings?latitude=${lat}&longitude=${lng}&method=4&timezonestring=${encodeURIComponent(timezone)}`);
        return j.data?.timings || null;
    } catch (e) { return null; }
}

export function formatTimingsSchedule(rawTimings = {}, timeZone) {
    const list = [
        { name: 'الفجر', key: 'Fajr', icon: '🕌' },
        { name: 'الشروق', key: 'Sunrise', icon: '🌅' },
        { name: 'الظهر', key: 'Dhuhr', icon: '🕌' },
        { name: 'العصر', key: 'Asr', icon: '🕌' },
        { name: 'المغرب', key: 'Maghrib', icon: '🕌' },
        { name: 'العشاء', key: 'Isha', icon: '🕌' }
    ];

    const lines = list.map(item => `${item.icon} ${item.name}: ${fmt12(rawTimings?.[item.key] || '')}`).join('\n');
    return `${lines}\n\n${getNextPrayerInfo(rawTimings, timeZone)}`;
}

export function getNextPrayerInfo(rawTimings = {}, timeZone) {
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
        diffMin = parseTimeToMinutes(rawTimings[nextKey]) - nowMin;
    } else {
        nextKey = 'Fajr';
        const fajrMin = parseTimeToMinutes(rawTimings?.Fajr);
        if (fajrMin !== null) diffMin = 1440 - nowMin + fajrMin;
    }

    return `⏳ القادمة: *${names[nextKey] || 'الفجر'}* بعد ${fmtDur(diffMin)}`;
}

export async function handlePrayerCommands(sock, targetJid, text, cleanText, subscribers, hadithSubscribers, msg) {
    if (cleanText === 'إلغاء الاشتراك' || cleanText === 'الغاء الاشتراك' || cleanText === 'إلغاء اشتراك' || cleanText === 'الغاء اشتراك') {
        if (subscribers[targetJid]) {
            delete subscribers[targetJid];
            await saveSubscribersToFirebase(subscribers, hadithSubscribers);
            await sock.sendMessage(targetJid, { text: `🛑 *تم إلغاء الاشتراك في خدمة مواقيت الصلاة بنجاح.*` }, { quoted: msg });
        } else {
            await sock.sendMessage(targetJid, { text: `ℹ️ أنت غير مشترك في خدمة مواقيت الصلاة حالياً.` }, { quoted: msg });
        }
        return true;
    }

    if (cleanText.startsWith('تعديل') || cleanText.startsWith('تغيير')) {
        const newCity = text.replace(/^(تعديل|تغيير)/i, '').trim();
        if (!newCity) {
            await sock.sendMessage(targetJid, { text: `❌ يرجى كتابة اسم المدينة الجديد بعد الأمر.\nمثال: *تعديل جازان*` }, { quoted: msg });
            return true;
        }

        const place = await getPlace(newCity);
        if (!place) {
            await sock.sendMessage(targetJid, { text: `❌ لم يتم العثور على المدينة "${newCity}".` }, { quoted: msg });
            return true;
        }

        const tz = place.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
        const rawTimings = await getPrayerTimings(place.latitude, place.longitude, tz);

        if (rawTimings) {
            subscribers[targetJid] = {
                cityName: place.name,
                country: place.country || '',
                lat: place.latitude,
                lng: place.longitude,
                timezone: tz,
                rawTimings: rawTimings,
                lastFetchDate: new Date().toLocaleDateString('en-CA', { timeZone: tz })
            };
            await saveSubscribersToFirebase(subscribers, hadithSubscribers);
            await sock.sendMessage(targetJid, { text: `✅ *تم تعديل المدينة بنجاح إلى (${place.name} - ${place.country || ''})!* 🔄` }, { quoted: msg });
        }
        return true;
    }

    return false;
}

const sentReminders = new Set();

export function startPrayerCheckLoop(sock, subscribers, hadithSubscribers) {
    setInterval(async () => {
        const now = new Date();
        const nowMs = Date.now();

        for (const [jid, config] of Object.entries(hadithSubscribers)) {
            try {
                if (!config.intervalMinutes || config.intervalMinutes <= 0) continue;
                if (nowMs - (config.lastSentTime || 0) >= config.intervalMinutes * 60 * 1000) {
                    hadithSubscribers[jid].lastSentTime = nowMs;
                    await saveSubscribersToFirebase(subscribers, hadithSubscribers);
                    const hadithText = await getHadithWithExplanationOnly();
                    await sock.sendMessage(jid, { text: hadithText });
                }
            } catch (err) {}
        }

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
                        await saveSubscribersToFirebase(subscribers, hadithSubscribers);
                    } else continue;
                }

                const rawTimings = subscribers[jid].rawTimings;
                if (!rawTimings) continue;

                const dateObj = getFormattedDate(tz);
                const hadithText = await getRandomHadith();
                const prayersToCheck = [
                    { name: 'الفجر', key: 'Fajr' }, { name: 'الظهر', key: 'Dhuhr' },
                    { name: 'العصر', key: 'Asr' }, { name: 'المغرب', key: 'Maghrib' }, { name: 'العشاء', key: 'Isha' }
                ];

                for (const item of prayersToCheck) {
                    const prayerTotalMin = parseTimeToMinutes(rawTimings[item.key]);
                    if (prayerTotalMin === null) continue;

                    const minBefore30 = prayerTotalMin - 30;
                    const key30 = `${jid}_${todayDateStr}_${item.name}_30min`;
                    if (Math.abs(currentTotalMin - minBefore30) <= 1 && !sentReminders.has(key30)) {
                        sentReminders.add(key30);
                        await sock.sendMessage(jid, { text: `⏳ *تنبيه: قرب صلاة ${item.name}* 🕌\n\n${dateObj.fullText}\n\nتبقّى 30 دقيقة على أذان صلاة *${item.name}* في مدينة *${info.cityName}* (${info.country}).\n\n✨ _جهز نفسك للصلاة وتهيأ للوضوء_\n\n───────────────\n${hadithText}` });
                    }

                    const keyExact = `${jid}_${todayDateStr}_${item.name}_exact`;
                    if (Math.abs(currentTotalMin - prayerTotalMin) <= 1 && !sentReminders.has(keyExact)) {
                        sentReminders.add(keyExact);
                        await sock.sendMessage(jid, { text: `🕌 *حان الآن أذان صلاة ${item.name}* 🌸\n\n${dateObj.fullText}\n\nحان الآن موعد أذان صلاة *${item.name}* حسب التوقيت المحلي لمدينة *${info.cityName}* (${info.country}).\n\n✨ _حيّ على الصلاة.. حيّ على الفلاح_\n\n───────────────\n${hadithText}` });
                    }

                    const minAfter10 = prayerTotalMin + 10;
                    const keyIqama = `${jid}_${todayDateStr}_${item.name}_iqama`;
                    if (Math.abs(currentTotalMin - minAfter10) <= 1 && !sentReminders.has(keyIqama)) {
                        sentReminders.add(keyIqama);
                        await sock.sendMessage(jid, { text: `🤲 *دعاء بين الأذان والإقامة (وقت مستجاب)* 🌟\n\nقال رسول الله ﷺ: «الدُّعَاءُ لاَ يُرَدُّ بَيْنَ الأَذَانِ وَالإِقَامَةِ»\n\n💡 *مِنَ الأَدْعِيَةِ الْمَأْثُورَةِ:*\n${getRandomItem(BETWEEN_AZAN_IQAMA_DUAS)}\n\n_استغل هذه اللحظات بالدعاء لنفسك ولمن تحب_ 🤍` });
                    }
                }

            } catch (err) {}
        }

        if (sentReminders.size > 1000) sentReminders.clear();
    }, 30 * 1000);
}
