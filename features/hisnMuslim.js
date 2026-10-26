import axios from 'axios';

const activeHisnTimers = {};

// قائمة بأهم أبواب حصن المسلم وفهرس الأرقام
const HISN_INDEX = [
    { id: 1, name: "أذكار الاستيقاظ من النوم" },
    { id: 9, name: "أذكار دخول الخلاء والخروج منه" },
    { id: 25, name: "أذكار الخروج من المنزل والدخول إليه" },
    { id: 27, name: "أذكار الذهاب إلى المسجد ودخوله الخروج منه" },
    { id: 28, name: "أذكار الأذان" },
    { id: 30, name: "دعاء الاستفتاح" },
    { id: 31, name: "دعاء الركوع والسجود" },
    { id: 35, name: "أذكار الصلاة والتأمين بعد الصلاة" },
    { id: 40, name: "أذكار الصباح والمساء" },
    { id: 50, name: "أذكار النوم والأحلام" },
    { id: 55, name: "دعاء قنوت الوتر" },
    { id: 60, name: "أذكار الهم والحزن والكرب" },
    { id: 70, name: "دعاء للقاء العدو وذي السلطان" },
    { id: 80, name: "دعاء من أصابته مصيبة" },
    { id: 90, name: "دعاء السفر والركوب" },
    { id: 100, name: "أذكار الطعام والشراب والضيف" }
];

// دالة جلب ذكر بباب محدد أو عشوائي
async function sendHisnText(sock, from, categoryId = null) {
    try {
        const categoryIds = [1, 9, 25, 27, 28, 30, 31, 35, 40, 50, 55, 60, 70, 80, 90, 100];
        const selectedId = categoryId || categoryIds[Math.floor(Math.random() * categoryIds.length)];
        
        const textRes = await axios.get(`https://www.hisnmuslim.com/api/ar/${selectedId}.json`, { timeout: 12000 });
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
        } else {
            await sock.sendMessage(from, { text: '❌ لم يتم العثور على أذكار في هذا الباب حالياً.' });
        }
    } catch (e) {
        console.error('Hisn Text API Error:', e.message);
        await sock.sendMessage(from, { text: '❌ حدث خطأ أثناء جلب الأذكار.' });
    }
}

// دالة عرض الفهرس المصمم
async function sendHisnIndex(sock, from, msg) {
    let indexText = `╮───────────────╭ـ
│「❥📲 **فهرس حصن المسلم** 📃❥」
│───────────────╰ـ
*╮ ───═┅─┅─┅═─── ╭*\n`;

    HISN_INDEX.forEach(item => {
        indexText += `│⚝ ⃟💎❯ *[ .حصن ${item.id} ]* ➔ ${item.name}\n`;
    });

    indexText += `*╯ ───═┅─┅─┅═─── ╰*\n\n`;
    indexText += `💡 *طريقة الاستخدام:*\n`;
    indexText += `• لطلب باب معين: اكتب رقم الباب بعد الأمر (مثال: *.حصن 40* لجلب أذكار الصباح والمساء).\n`;
    indexText += `• للتكرار الدوري: اكتب الوقت بالدقائق (مثال: *.حصن 10د*).\n`;
    indexText += `• للإيقاف: اكتب *.حصن وقف*`;

    await sock.sendMessage(from, { text: indexText }, { quoted: msg });
}

export async function handleHisnCommands(sock, msg, from, cleanText) {
    if (cleanText.startsWith('.حصن') || cleanText.startsWith('.أذكار') || cleanText.startsWith('.اذكار')) {
        const args = cleanText.split(' ').slice(1).join('').trim();

        // 1. طلب الفهرس
        if (args === 'فهرس' || args === 'الفهرس' || args === 'أبواب' || args === 'ابواب') {
            await sendHisnIndex(sock, from, msg);
            return true;
        }

        // 2. إيقاف التكرار الدوري
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

        // 3. التكرار الدوري مع رقم الباب أو بدون رقم باب (مثال: .حصن 10د  أو .حصن 40 10د)
        const matchMinutes = args.match(/(\d+)د/);
        if (matchMinutes) {
            const minutes = parseInt(matchMinutes[1]);
            if (minutes < 1) return true;

            // كشف إذا حدد المستخدم رقم باب مع الدقائق
            const categoryMatch = args.match(/^(\d+)/);
            const categoryId = categoryMatch ? parseInt(categoryMatch[1]) : null;

            if (activeHisnTimers[from]) clearInterval(activeHisnTimers[from]);
            await sock.sendMessage(from, { react: { text: '⏰', key: msg.key } });
            await sock.sendMessage(from, { text: `✅ تم تفعيل الإرسال التلقائي لأذكار حصن المسلم كل *${minutes}* دقيقة.` }, { quoted: msg });
            
            await sendHisnText(sock, from, categoryId);
            activeHisnTimers[from] = setInterval(() => sendHisnText(sock, from, categoryId), minutes * 60 * 1000);
            return true;
        }

        // 4. طلب باب محدد برقم الباب (مثال: .حصن 40)
        const categoryNumber = parseInt(args);
        if (!isNaN(categoryNumber) && categoryNumber > 0) {
            await sock.sendMessage(from, { react: { text: '🛡️', key: msg.key } });
            await sendHisnText(sock, from, categoryNumber);
            return true;
        }

        // 5. طلب ذكر عشوائي مباشر (عند إرسال .حصن فقط)
        await sock.sendMessage(from, { react: { text: '🛡️', key: msg.key } });
        await sendHisnText(sock, from);
        return true;
    }
    return false;
}
