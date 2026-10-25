import axios from 'axios';

const activeDuaTimers = {};

async function sendDua(sock, from) {
    try {
        const keyword = encodeURIComponent('ربنا');
        const duaRes = await axios.get(`https://api.alquran.cloud/v1/search/${keyword}/all/ar.alafasy`, { timeout: 10000 });
        const matches = duaRes.data.data.matches;
        const randomDua = matches[Math.floor(Math.random() * matches.length)];

        const duaText = randomDua.text;
        const surahName = randomDua.surah.name;
        const ayahNumber = randomDua.numberInSurah;

        const cardText = `╮───────────────╭ـ
│「❥📲 **دعاء مستجاب** 📃❥」
│───────────────╰ـ
*╮ ───═┅─┅─┅═─── ╭*
│⚝ ⃟🎖️❯ 🤲 *من دعاء القرآن الكريم:*
│⚝ ⃟🧰❯ ﴿ ${duaText} ﴾
│⚝ ⃟⚓❯ 📌 *سورة:* ${surahName} | *الآية:* ${ayahNumber}
*╯ ───═┅─┅─┅═─── ╰*`;

        await sock.sendMessage(from, { text: cardText });
    } catch (e) {
        console.error('Dua API Error:', e.message);
    }
}

export async function handleDuaCommands(sock, msg, from, cleanText) {
    if (cleanText.startsWith('.دعاء') || cleanText.startsWith('.أدعية') || cleanText.startsWith('.ادعية')) {
        const args = cleanText.split(' ').slice(1).join('').trim();
        if (args === 'وقف' || args === 'ايقاف' || args === 'إيقاف') {
            if (activeDuaTimers[from]) {
                clearInterval(activeDuaTimers[from]);
                delete activeDuaTimers[from];
                await sock.sendMessage(from, { text: '🛑 تم إيقاف الإرسال التلقائي للأدعية بنجاح.' }, { quoted: msg });
            } else {
                await sock.sendMessage(from, { text: 'ℹ️ لا يوجد إرسال تلقائي للأدعية مفعّل لديك.' }, { quoted: msg });
            }
            return true;
        }

        const matchMinutes = args.match(/(\d+)د/);
        if (matchMinutes) {
            const minutes = parseInt(matchMinutes[1]);
            if (minutes < 1) return true;
            if (activeDuaTimers[from]) clearInterval(activeDuaTimers[from]);
            await sock.sendMessage(from, { react: { text: '⏰', key: msg.key } });
            await sock.sendMessage(from, { text: `✅ تم تفعيل الإرسال التلقائي للأدعية كل *${minutes}* دقيقة.` }, { quoted: msg });
            await sendDua(sock, from);
            activeDuaTimers[from] = setInterval(() => sendDua(sock, from), minutes * 60 * 1000);
            return true;
        }

        await sock.sendMessage(from, { react: { text: '🤲', key: msg.key } });
        await sendDua(sock, from);
        return true;
    }
    return false;
}
