import fetch from 'node-fetch';
import { saveSubscribersToFirebase } from '../config/firebase.js';

export const BACKUP_HADITHS = [
    { hadith: "«إِنَّ الصَّلَاةَ كَانَتْ عَلَى الْمُؤْمِنِينَ كِتَابًا مَوْقُوتًا»", source: "سورة النساء - آية 103" },
    { hadith: "«بُنِيَ الإِسْلاَمُ عَلَى خَمْسٍ: شَهَادَةِ أَنْ لاَ إِلَهَ إِلاَّ اللَّهُ وَأَنَّ مُحَمَّدًا رَسُولُ اللَّهِ، وَإِقَامِ الصَّلاَةِ، وَإِيتَاءِ الزَّكَاةِ، وَالحَجِّ، وَصَوْمِ رَمَضَانَ»", source: "صحيح البخاري" },
    { hadith: "«سُئِلَ النَّبِيُّ ﷺ: أَيُّ الأَعْمَالِ أَفْضَلُ؟ قَالَ: الصَّلاَةُ لِوَقْتِهَا»", source: "متفق عليه" },
    { hadith: "«مَنْ صَلَّى الْبَرْدَيْنِ دَخَلَ الْجَنَّةَ»", source: "صحيح البخاري" }
];

export const BETWEEN_AZAN_IQAMA_DUAS = [
    "«اللَّهُمَّ رَبَّ هَذِهِ الدَّعْوَةِ التَّامَّةِ، وَالصَّلاَةِ الْقَائِمَةِ، آتِ مُحَمَّدًا الْوَسِيلَةَ وَالْفَضِيلَةَ، وَابْعَثْهُ مَقَامًا مَحْمُودًا الَّذِي وَعَدْتَهُ»",
    "«اللَّهُمَّ إِنِّي أَسْأَلُكَ الْعَفْوَ وَالْعَافِيَةَ فِي الدُّنْيَا وَالآخِرَةِ»",
    "«رَضِيتُ بِاللَّهِ رَبًّا، وَبِمُحَمَّدٍ رَسُولاً، وَبالإِسْلاَمِ دِينًا»"
];

export function getRandomItem(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

export async function getRandomHadith() {
    try {
        const categories = [2, 3, 4, 5]; 
        const randomCat = getRandomItem(categories);
        const res = await fetch(`https://hadeethenc.com/api/v1/hadeeths/list/?language=ar&category_id=${randomCat}&page=1&per_page=20`);

        if (res.ok) {
            const data = await res.json();
            if (data?.data?.length > 0) {
                const randomItem = getRandomItem(data.data);
                const detailRes = await fetch(`https://hadeethenc.com/api/v1/hadeeths/one/?language=ar&id=${randomItem.id}`);

                if (detailRes.ok) {
                    const detailData = await detailRes.json();
                    let text = `📜 *حديث اليوم (من موسوعة HadeethEnc):*\n«${detailData.hadeeth.trim()}»`;
                    if (detailData.explanation) text += `\n\n💡 *الشرح:* ${detailData.explanation.trim()}`;
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

export async function getHadithWithExplanationOnly() {
    try {
        const categories = [2, 3, 4, 5];
        const randomCat = getRandomItem(categories);
        const res = await fetch(`https://hadeethenc.com/api/v1/hadeeths/list/?language=ar&category_id=${randomCat}&page=1&per_page=25`);

        if (res.ok) {
            const data = await res.json();
            if (data?.data?.length > 0) {
                const randomItem = getRandomItem(data.data);
                const detailRes = await fetch(`https://hadeethenc.com/api/v1/hadeeths/one/?language=ar&id=${randomItem.id}`);

                if (detailRes.ok) {
                    const detailData = await detailRes.json();
                    let text = `📜 *حديث نبوي شريف:*\n«${detailData.hadeeth.trim()}»`;
                    if (detailData.explanation) text += `\n\n💡 *الشرح:* ${detailData.explanation.trim()}`;
                    return text;
                }
            }
        }
    } catch (e) {}

    const backup = getRandomItem(BACKUP_HADITHS);
    return `📜 *حديث نبوي شريف:*\n${backup.hadith}`;
}

export async function handleHadithCommands(sock, targetJid, text, subscribers, hadithSubscribers, msg) {
    const hadithMatch = text.match(/^حديث\s*(\d+)\s*د/i);
    if (hadithMatch) {
        const mins = parseInt(hadithMatch[1], 10);
        if (mins && mins > 0) {
            hadithSubscribers[targetJid] = { intervalMinutes: mins, lastSentTime: Date.now() };
            await saveSubscribersToFirebase(subscribers, hadithSubscribers);

            await sock.sendMessage(targetJid, { text: `✅ *تم تفعيل التذكير الدوري بالأحاديث الشريفة!*\n\nسيتم إرسال حديث نبوي مع الشرح كل *${mins} دقيقة* تلقائياً. 📜✨\n\n_لإيقاف التذكير بالأحاديث أرسل:_ *إيقاف الحديث*` }, { quoted: msg });
            const firstHadith = await getHadithWithExplanationOnly();
            await sock.sendMessage(targetJid, { text: firstHadith });
            return true;
        }
    }
    return false;
}
