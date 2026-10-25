import axios from 'axios';

const activeQuranTimers = {};

async function sendQuranAyah(sock, from) {
    try {
        const randomAyahNum = Math.floor(Math.random() * 6236) + 1;
        const [quranRes, tafseerRes] = await Promise.all([
            axios.get(`https://api.alquran.cloud/v1/ayah/${randomAyahNum}/ar.alafasy`, { timeout: 10000 }),
            axios.get(`https://api.alquran.cloud/v1/ayah/${randomAyahNum}/ar.muyassar`, { timeout: 10000 })
        ]);

        const ayahData = quranRes.data.data;
        const tafseerText = tafseerRes.data.data.text;
        const ayahText = ayahData.text;
        const surahName = ayahData.surah.name;
        const ayahNumber = ayahData.numberInSurah;

        const cardText = `╮───────────────╭ـ
│「❥📲 **تذكير وآية قرآنية** 📃❥」
│───────────────╰ـ
*╮ ───═┅─┅─┅═─── ╭*
│⚝ ⃟🎖️❯ 📖 *سورة:* ${surahName} (الآية: ${ayahNumber})
│⚝ ⃟🧰❯ ﴿ ${ayahText} ﴾
│⚝ ⃟⚓❯ 💡 *التفسير الميسر:*
${tafseerText}
*╯ ───═┅─┅─┅═─── ╰*`;

        await sock.sendMessage(from, { text: cardText });
    } catch (e) {
        console.error('Quran API Error:', e.message);
    }
}

export async function handleQuranTafseerCommands(sock, msg, from, cleanText) {
    if (cleanText.startsWith('.آية') || cleanText.startsWith('.اية') || cleanText.startsWith('.قرآن') || cleanText.startsWith('.قران')) {
        const args = cleanText.split(' ').slice(1).join('').trim();
        if (args === 'وقف' || args === 'ايقاف' || args === 'إيقاف') {
            if (activeQuranTimers[from]) {
                clearInterval(activeQuranTimers[from]);
                delete activeQuranTimers[from];
                await sock.sendMessage(from, { text: '🛑 تم إيقاف الإرسال التلقائي للآيات بنجاح.' }, { quoted: msg });
            } else {
                await sock.sendMessage(from, { text: 'ℹ️ لا يوجد إرسال تلقائي للآيات مفعّل لديك.' }, { quoted: msg });
            }
            return true;
        }

        const matchMinutes = args.match(/(\d+)د/);
        if (matchMinutes) {
            const minutes = parseInt(matchMinutes[1]);
            if (minutes < 1) return true;
            if (activeQuranTimers[from]) clearInterval(activeQuranTimers[from]);
            await sock.sendMessage(from, { react: { text: '⏰', key: msg.key } });
            await sock.sendMessage(from, { text: `✅ تم تفعيل الإرسال التلقائي للآيات كل *${minutes}* دقيقة.` }, { quoted: msg });
            await sendQuranAyah(sock, from);
            activeQuranTimers[from] = setInterval(() => sendQuranAyah(sock, from), minutes * 60 * 1000);
            return true;
        }

        await sock.sendMessage(from, { react: { text: '📖', key: msg.key } });
        await sendQuranAyah(sock, from);
        return true;
    }
    return false;
}
