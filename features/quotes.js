import axios from 'axios';

const activeQuoteTimers = {};

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

async function sendQuote(sock, from) {
    try {
        const zenRes = await axios.get('https://zenquotes.io/api/random', { timeout: 10000 });
        const quoteData = zenRes.data[0];
        const englishQuote = quoteData.q;
        const author = quoteData.a;

        const arabicQuote = await translateViaAPI(englishQuote);

        const cardText = `╮───────────────╭ـ
│「❥📲 **حكمة اليوم** 📃❥」
│───────────────╰ـ
*╮ ───═┅─┅─┅═─── ╭*
│⚝ ⃟🎖️❯ 💎 *بالعربية:*
"${arabicQuote}"
│⚝ ⃟🧰❯ 🌐 *English:*
_"${englishQuote}"_
│⚝ ⃟⚓❯ 👤 *القائل:* ${author}
*╯ ───═┅─┅─┅═─── ╰*`;

        await sock.sendMessage(from, { text: cardText });
    } catch (e) {
        console.error('ZenQuotes API Error:', e.message);
    }
}

export async function handleQuoteCommands(sock, msg, from, cleanText) {
    if (cleanText.startsWith('.حكمة') || cleanText.startsWith('.اقتباس') || cleanText.startsWith('.حكم')) {
        const args = cleanText.split(' ').slice(1).join('').trim();
        if (args === 'وقف' || args === 'ايقاف' || args === 'إيقاف') {
            if (activeQuoteTimers[from]) {
                clearInterval(activeQuoteTimers[from]);
                delete activeQuoteTimers[from];
                await sock.sendMessage(from, { text: '🛑 تم إيقاف الإرسال التلقائي للحكم بنجاح.' }, { quoted: msg });
            } else {
                await sock.sendMessage(from, { text: 'ℹ️ لا يوجد إرسال تلقائي للحكم مفعّل لديك.' }, { quoted: msg });
            }
            return true;
        }

        const matchMinutes = args.match(/(\d+)د/);
        if (matchMinutes) {
            const minutes = parseInt(matchMinutes[1]);
            if (minutes < 1) return true;
            if (activeQuoteTimers[from]) clearInterval(activeQuoteTimers[from]);
            await sock.sendMessage(from, { react: { text: '⏰', key: msg.key } });
            await sock.sendMessage(from, { text: `✅ تم تفعيل الإرسال التلقائي للحكم كل *${minutes}* دقيقة.` }, { quoted: msg });
            await sendQuote(sock, from);
            activeQuoteTimers[from] = setInterval(() => sendQuote(sock, from), minutes * 60 * 1000);
            return true;
        }

        await sock.sendMessage(from, { react: { text: '💡', key: msg.key } });
        await sendQuote(sock, from);
        return true;
    }
    return false;
}
