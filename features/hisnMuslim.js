import axios from 'axios';

const activeHisnTimers = {};

async function sendHisnText(sock, from) {
    try {
        const categoryIds = [27, 28, 1, 9, 25, 30, 31, 35, 40, 50, 55, 60, 70, 80, 90, 100];
        const randomId = categoryIds[Math.floor(Math.random() * categoryIds.length)];
        
        const textRes = await axios.get(`https://www.hisnmuslim.com/api/ar/${randomId}.json`, { timeout: 12000 });
        const categoryKey = Object.keys(textRes.data)[0];
        const azkarList = textRes.data[categoryKey];

        if (azkarList && azkarList.length > 0) {
            const randomZikr = azkarList[Math.floor(Math.random() * azkarList.length)];
            const zikrText = randomZikr.ARABIC_TEXT;
            const repeatCount = randomZikr.REPEAT || 1;

            const cardText = `╮───────────────╭ـ
│「❥📲 **حصن المسلم** 📃❥」
│───────────────╰ـ
*╮ ───═┅─┅─┅═─── ╭*
│⚝ ⃟🎖️❯ 🛡️ *الباب:* ${categoryKey}
│⚝ ⃟🧰❯ 💬 *الذكر:*
"${zikrText}"
│⚝ ⃟⚓❯ 🔁 *التكرار:* ${repeatCount} مرة
*╯ ───═┅─┅─┅═─── ╰*`;

            await sock.sendMessage(from, { text: cardText });
        }
    } catch (e) {
        console.error('Hisn Text API Error:', e.message);
    }
}

export async function handleHisnCommands(sock, msg, from, cleanText) {
    if (cleanText.startsWith('.حصن') || cleanText.startsWith('.أذكار') || cleanText.startsWith('.اذكار')) {
        const args = cleanText.split(' ').slice(1).join('').trim();
        if (args === 'وقف' || args === 'ايقاف' || args === 'إيقاف') {
            if (activeHisnTimers[from]) {
                clearInterval(activeHisnTimers[from]);
                delete activeHisnTimers[from];
                await sock.sendMessage(from, { text: '🛑 تم إيقاف الإرسال التلقائي لأذكار حصن المسلم بنجاح.' }, { quoted: msg });
            } else {
                await sock.sendMessage(from, { text: 'ℹ️ لا يوجد إرسال تلقائي لأذكار حصن المسلم مفعّل لديك.' }, { quoted: msg });
            }
            return true;
        }

        const matchMinutes = args.match(/(\d+)د/);
        if (matchMinutes) {
            const minutes = parseInt(matchMinutes[1]);
            if (minutes < 1) return true;
            if (activeHisnTimers[from]) clearInterval(activeHisnTimers[from]);
            await sock.sendMessage(from, { react: { text: '⏰', key: msg.key } });
            await sock.sendMessage(from, { text: `✅ تم تفعيل الإرسال التلقائي لأذكار حصن المسلم كل *${minutes}* دقيقة.` }, { quoted: msg });
            await sendHisnText(sock, from);
            activeHisnTimers[from] = setInterval(() => sendHisnText(sock, from), minutes * 60 * 1000);
            return true;
        }

        await sock.sendMessage(from, { react: { text: '🛡️', key: msg.key } });
        await sendHisnText(sock, from);
        return true;
    }
    return false;
}
