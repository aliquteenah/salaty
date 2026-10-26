import axios from 'axios';

const activeHisnTimers = {};
const hisnProgress = {};

// دالة جلب الذكر ترتيبي أو عشوائي
async function sendHisnSequentialText(sock, from, categoryId, index = 0) {
    try {
        const textRes = await axios.get(`https://www.hisnmuslim.com/api/ar/${categoryId}.json`, { timeout: 12000 });
        const categoryKey = Object.keys(textRes.data)[0];
        const azkarList = textRes.data[categoryKey];

        if (!azkarList || azkarList.length === 0) {
            await sock.sendMessage(from, { text: '❌ لم يتم العثور على أذكار في هذا الباب حالياً.' });
            return false;
        }

        const currentIndex = index % azkarList.length;
        const currentZikr = azkarList[currentIndex];
        const zikrText = currentZikr.ARABIC_TEXT;
        const repeatCount = currentZikr.REPEAT || 1;

        const cardText = `╮───────────────╭ـ
│「❥📲 **حصن المسلم** 📃❥」
│───────────────╰ـ
*╮ ───═┅─┅─┅═─── ╭*
│ 🛡️ *الباب (${categoryId}):* ${categoryKey}
│ 🔢 *الذكر:* (${currentIndex + 1}/${azkarList.length})
│ 💬 *الذكر:*
"${zikrText}"
│ 🔁 *التكرار المطلوبة:* ${repeatCount} مرة
*╯ ───═┅─┅─┅═─── ╰*`;

        await sock.sendMessage(from, { text: cardText });

        // التحقق مما إذا كان هذا هو الذكر الأخير في الباب
        if (currentIndex + 1 >= azkarList.length) {
            return true; // اكتملت الأذكار
        }
        return false; // لم تكتمل بعد
    } catch (e) {
        console.error('Hisn Text API Error:', e.message);
        return false;
    }
}

// دالة عرض الفهرس المعالجة (تم إصلاح undefined وإزالة الرموز)
async function sendHisnIndex(sock, from, msg, page = 1) {
    try {
        await sock.sendMessage(from, { react: { text: '📜', key: msg.key } });

        const response = await axios.get('https://www.hisnmuslim.com/api/ar/husn_ar.json', { timeout: 10000 });
        const categories = response.data['العربية'] || response.data[Object.keys(response.data)[0]];

        const pageSize = 20;
        const totalPages = Math.ceil(categories.length / pageSize);
        const currentPage = Math.max(1, Math.min(page, totalPages));

        const startIndex = (currentPage - 1) * pageSize;
        const pageItems = categories.slice(startIndex, startIndex + pageSize);

        let indexText = `╮───────────────╭ـ
│「❥📲 **فهرس حصن المسلم (صفحة ${currentPage}/${totalPages})** 📃❥」
│───────────────╰ـ
*╮ ───═┅─┅─┅═─── ╭*\n`;

        pageItems.forEach(item => {
            const catId = item.ID || item.id;
            indexText += `│ 🔹 *[ .حصن ${catId} ]* ➔ ${item.TITLE}\n`;
        });

        indexText += `*╯ ───═┅─┅─┅═─── ╰*\n\n`;
        indexText += `💡 *خيارات التنقل والطلب:*\n`;
        if (currentPage < totalPages) {
            indexText += `• للصفحة التالية أرسل: *.حصن فهرس ${currentPage + 1}*\n`;
        }
        indexText += `• لطلب أذكار باب معين بالتتابع الدوري: أرسل رقم الباب والدقائق (مثال: *.حصن 1 2د*).\n`;
        indexText += `• لإيقاف التكرار: أرسل *.حصن وقف*`;

        await sock.sendMessage(from, { text: indexText }, { quoted: msg });
    } catch (e) {
        console.error('Hisn Index API Error:', e.message);
        await sock.sendMessage(from, { text: '❌ تعذر جلب الفهرس الكامل حالياً.' }, { quoted: msg });
    }
}

export async function handleHisnCommands(sock, msg, from, cleanText) {
    if (cleanText.startsWith('.حصن') || cleanText.startsWith('.أذكار') || cleanText.startsWith('.اذكار')) {
        const args = cleanText.split(' ').slice(1).join(' ').trim();

        // 1. عرض الفهرس (.حصن فهرس)
        if (args.startsWith('فهرس') || args.startsWith('الفهرس') || args.startsWith('أبواب') || args.startsWith('ابواب')) {
            const pageMatch = args.match(/\d+/);
            const page = pageMatch ? parseInt(pageMatch[0]) : 1;
            await sendHisnIndex(sock, from, msg, page);
            return true;
        }

        // 2. إيقاف التكرار الدوري (.حصن وقف)
        if (args === 'وقف' || args === 'ايقاف' || args === 'إيقاف') {
            if (activeHisnTimers[from]) {
                clearInterval(activeHisnTimers[from]);
                delete activeHisnTimers[from];
                delete hisnProgress[from];
                await sock.sendMessage(from, { text: '🛑 تم إيقاف الإرسال التلقائي لأذكار حصن المسلم بنجاح.' }, { quoted: msg });
            } else {
                await sock.sendMessage(from, { text: 'ℹ️ لا يوجد إرسال تلقائي لأذكار حصن المسلم مفعّل لديك.' }, { quoted: msg });
            }
            return true;
        }

        // 3. التكرار الدوري الترتيبي (مثال: .حصن 1 2د)
        const matchMinutes = args.match(/(\d+)د/);
        if (matchMinutes) {
            const minutes = parseInt(matchMinutes[1]);
            if (minutes < 1) return true;

            // تحديد رقم الباب المدخل
            const categoryMatch = args.match(/^(\d+)/);
            const categoryId = categoryMatch ? parseInt(categoryMatch[1]) : 1;

            if (activeHisnTimers[from]) clearInterval(activeHisnTimers[from]);

            hisnProgress[from] = { categoryId, currentIndex: 0 };

            await sock.sendMessage(from, { react: { text: '⏰', key: msg.key } });
            await sock.sendMessage(from, { text: `✅ تم تفعيل إرسال أذكار الباب رقم (${categoryId}) بالتتابع كل *${minutes}* دقيقة حتى اكتمال الأذكار.` }, { quoted: msg });

            // إرسال الذكر الأول مباشرة
            const isCompletedFirst = await sendHisnSequentialText(sock, from, categoryId, 0);
            if (isCompletedFirst) {
                await sock.sendMessage(from, { text: `🎉 *تمت بحمد الله قراءة جميع أذكار هذا الباب بالكامل.*` });
                return true;
            }

            hisnProgress[from].currentIndex++;

            // ضبط المؤقت التكراري الترتيبي
            activeHisnTimers[from] = setInterval(async () => {
                const prog = hisnProgress[from];
                if (!prog) return;

                const isCompleted = await sendHisnSequentialText(sock, from, prog.categoryId, prog.currentIndex);

                if (isCompleted) {
                    clearInterval(activeHisnTimers[from]);
                    delete activeHisnTimers[from];
                    delete hisnProgress[from];
                    await sock.sendMessage(from, { text: `🎉 *تمت بحمد الله قراءة جميع أذكار هذا الباب بالكامل.*` });
                } else {
                    prog.currentIndex++;
                }
            }, minutes * 60 * 1000);

            return true;
        }

        // 4. طلب باب محدد مفرداً (مثال: .حصن 1)
        const categoryNumber = parseInt(args);
        if (!isNaN(categoryNumber) && categoryNumber > 0) {
            await sock.sendMessage(from, { react: { text: '🛡️', key: msg.key } });
            await sendHisnSequentialText(sock, from, categoryNumber, 0);
            return true;
        }

        // 5. طلب عشوائي عند كتابة (.حصن) فقط
        await sock.sendMessage(from, { react: { text: '🛡️', key: msg.key } });
        await sendHisnSequentialText(sock, from, 1, 0);
        return true;
    }
    return false;
}
