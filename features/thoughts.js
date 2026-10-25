import axios from 'axios';

const activeThoughtTimers = {};

async function translateViaAPI(text) {
    try {
        const res = await axios.get(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|ar`, { timeout: 6000 });
        let translated = res.data.responseData.translatedText || text;
        return translated
            .replace(/قومي/g, "قم")
            .replace(/تريدينها/g, "تريدها")
            .replace(/أنتِ/g, "أنت");
    } catch (err) {
        return text;
    }
}

async function sendThought(sock, from) {
    try {
        const favRes = await axios.get('https://favqs.com/api/qotd', { timeout: 10000 });
        const thoughtData = favRes.data.quote;
        const englishThought = thoughtData.body;
        const author = thoughtData.author || 'غير معروف';

        const arabicThought = await translateViaAPI(englishThought);

        const cardText = `╮───────────────╭ـ
│「❥📲 **خاطرة وأدب** 📃❥」
│───────────────╰ـ
*╮ ───═┅─┅─┅═─── ╭*
│⚝ ⃟🎖️❯ ✍️ *الخاطرة:*
"${arabicThought}"
│⚝ ⃟🧰❯ 🌐 *Original:*
_"${englishThought}"_
│⚝ ⃟⚓❯ ✒️ *الكاتب:* ${author}
*╯ ───═┅─┅─┅═─── ╰*`;

        await sock.sendMessage(from, { text: cardText });
    } catch (e) {
        console.error('FavQs API Error:', e.message);
    }
}

export async function handleThoughtCommands(sock, msg, from, cleanText) {
    if (cleanText.startsWith('.خاطرة') || cleanText.startsWith('.خواطر') || cleanText.startsWith('.رسالة')) {
        const args = cleanText.split(' ').slice(1).join('').trim();
        if (args === 'وقف' || args === 'ايقاف' || args === 'إيقاف') {
            if (activeThoughtTimers[from]) {
                clearInterval(activeThoughtTimers[from]);
                delete activeThoughtTimers[from];
                await sock.sendMessage(from, { text: '🛑 تم إيقاف الإرسال التلقائي للخواطر بنجاح.' }, { quoted: msg });
            } else {
                await sock.sendMessage(from, { text: 'ℹ️ لا يوجد إرسال تلقائي للخواطر مفعّل لديك.' }, { quoted: msg });
            }
            return true;
        }

        const matchMinutes = args.match(/(\d+)د/);
        if (matchMinutes) {
            const minutes = parseInt(matchMinutes[1]);
            if (minutes < 1) return true;
            if (activeThoughtTimers[from]) clearInterval(activeThoughtTimers[from]);
            await sock.sendMessage(from, { react: { text: '⏰', key: msg.key } });
            await sock.sendMessage(from, { text: `✅ تم تفعيل الإرسال التلقائي للخواطر كل *${minutes}* دقيقة.` }, { quoted: msg });
            await sendThought(sock, from);
            activeThoughtTimers[from] = setInterval(() => sendThought(sock, from), minutes * 60 * 1000);
            return true;
        }

        await sock.sendMessage(from, { react: { text: '✍️', key: msg.key } });
        await sendThought(sock, from);
        return true;
    }
    return false;
}
