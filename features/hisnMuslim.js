import axios from 'axios';

const activeHisnTimers = {};

// دالة جلب الذكر (سواء محدد برقم الباب أو عشوائي)
async function sendHisnText(sock, from, categoryId = null) {
    try {
        let selectedId = categoryId;
        
        // إذا لم يحدد المستخدم رقم باب، يتم جلب قائمة الأبواب واختيار باب عشوائي منها
        if (!selectedId) {
            const indexRes = await axios.get('https://www.hisnmuslim.com/api/ar/husn_ar.json', { timeout: 10000 });
            const categories = indexRes.data['العربية'] || indexRes.data[Object.keys(indexRes.data)[0]];
            const randomCategory = categories[Math.floor(Math.random() * categories.length)];
            selectedId = randomCategory.id;
        }

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
│⚝ ⃟🎖️❯ 🛡️ *الباب (${selectedId}):* ${categoryKey}
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
        await sock.sendMessage(from, { text: '❌ حدث خطأ أثناء جلب الأذكار. التأكد من رقم الباب.' });
    }
}

// دالة جلب وعرض الفهرس الكامل المباشر من API حصن المسلم
async function sendHisnIndex(sock, from, msg, page = 1) {
    try {
        await sock.sendMessage(from, { react: { text: '📜', key: msg.key } });

        const response = await axios.get('https://www.hisnmuslim.com/api/ar/husn_ar.json', { timeout: 10000 });
        const categories = response.data['العربية'] || response.data[Object.keys(response.data)[0]];

        const pageSize = 25; // عدد الأبواب في الرسالة الواحدة
        const totalPages = Math.ceil(categories.length / pageSize);
        const currentPage = Math.max(1, Math.min(page, totalPages));

        const startIndex = (currentPage - 1) * pageSize;
        const pageItems = categories.slice(startIndex, startIndex + pageSize);

        let indexText = `╮───────────────╭ـ
│「❥📲 **فهرس حصن المسلم (صفحة ${currentPage}/${totalPages})** 📃❥」
│───────────────╰ـ
*╮ ───═┅─┅─┅═─── ╭*\n`;

        pageItems.forEach(item => {
            indexText += `│⚝ ⃟💎❯ *[ .حصن ${item.id} ]* ➔ ${item.TITLE}\n`;
        });

        indexText += `*╯ ───═┅─┅─┅═─── ╰*\n\n`;
        indexText += `💡 *خيارات التنقل والطلب:*\n`;
        if (currentPage < totalPages) {
            indexText += `• للتنقل للصفحة التالية أرسل: *.حصن فهرس ${currentPage + 1}*\n`;
        }
        indexText += `• لطلب باب معين أرسل أمره (مثال: *.حصن 27* لجلب أذكار المسجد).\n`;
        indexText += `• للتكرار الدوري: *.حصن 10د*\n`;
        indexText += `• للإيقاف: *.حصن وقف*`;

        await sock.sendMessage(from, { text: indexText }, { quoted: msg });
    } catch (e) {
        console.error('Hisn Index API Error:', e.message);
        await sock.sendMessage(from, { text: '❌ تعذر جلب الفهرس الكامل حالياً.' }, { quoted: msg });
    }
}

export async function handleHisnCommands(sock, msg, from, cleanText) {
    if (cleanText.startsWith('.حصن') || cleanText.startsWith('.أذكار') || cleanText.startsWith('.اذكار')) {
        const args = cleanText.split(' ').slice(1).join('').trim();

        // 1. طلب الفهرس (مع دعم الصفحات .حصن فهرس 2)
        if (args.startsWith('فهرس') || args.startsWith('الفهرس') || args.startsWith('أبواب') || args.startsWith('ابواب')) {
            const pageMatch = args.match(/\d+/);
            const page = pageMatch ? parseInt(pageMatch[0]) : 1;
            await sendHisnIndex(sock, from, msg, page);
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

        // 3. التكرار الدوري مع رقم الباب أو بدونه (مثال: .حصن 10د أو .حصn 27 10د)
        const matchMinutes = args.match(/(\d+)د/);
        if (matchMinutes) {
            const minutes = parseInt(matchMinutes[1]);
            if (minutes < 1) return true;

            const categoryMatch = args.match(/^(\d+)/);
            const categoryId = categoryMatch ? parseInt(categoryMatch[1]) : null;

            if (activeHisnTimers[from]) clearInterval(activeHisnTimers[from]);
            await sock.sendMessage(from, { react: { text: '⏰', key: msg.key } });
            await sock.sendMessage(from, { text: `✅ تم تفعيل الإرسال التلقائي لأذكار حصن المسلم كل *${minutes}* دقيقة.` }, { quoted: msg });
            
            await sendHisnText(sock, from, categoryId);
            activeHisnTimers[from] = setInterval(() => sendHisnText(sock, from, categoryId), minutes * 60 * 1000);
            return true;
        }

        // 4. طلب باب محدد برقم الباب المأخوذ من الفهرس (مثال: .حصن 27)
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
