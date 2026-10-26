import axios from 'axios';

const activeHisnTimers = {};
const hisnProgress = {};
const autoHisnTimers = {};

// دالة تحديد الباب المناسب بناءً على الوقت الحالي في اليوم
function getSmartCategoryByTime() {
    const currentHour = new Date().getHours();

    // الفجر والصباح الباكر: أذكار الاستيقاظ (الباب 1)
    if (currentHour >= 4 && currentHour < 6.5) {
        return 1;
    }
    // الصباح: أذكار الصباح (الباب 40)
    else if (currentHour >= 6.5 && currentHour < 11.5) {
        return 40;
    }
    // الظهيرة والعصر: أذكار متنوعة (مسجد، طعام، خروج من المنزل)
    else if (currentHour >= 11.5 && currentHour < 16.5) {
        const midDayCategories = [25, 27, 35, 100];
        return midDayCategories[Math.floor(Math.random() * midDayCategories.length)];
    }
    // المساء: أذكار المساء (الباب 40)
    else if (currentHour >= 16.5 && currentHour < 21) {
        return 40;
    }
    // الليل والنوم: أذكار النوم (الباب 50) أو قنوت الوتر (الباب 55)
    else {
        const nightCategories = [50, 55, 60];
        return nightCategories[Math.floor(Math.random() * nightCategories.length)];
    }
}

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
│「❥📲 **حصن المسلم الذكي** 📃❥」
│───────────────╰ـ
*╮ ───═┅─┅─┅═─── ╭*
│ 🛡️ *الباب (${categoryId}):* ${categoryKey}
│ 🔢 *الذكر:* (${currentIndex + 1}/${azkarList.length})
│ 💬 *الذكر:*
"${zikrText}"
│ 🔁 *التكرار المطلوبة:* ${repeatCount} مرة
*╯ ───═┅─┅─┅═─── ╰*`;

        await sock.sendMessage(from, { text: cardText });

        if (currentIndex + 1 >= azkarList.length) {
            return true; 
        }
        return false; 
    } catch (e) {
        console.error('Hisn Text API Error:', e.message);
        return false;
    }
}

// دالة إرسال التنبيه التلقائي الذكي على مدار 24 ساعة
async function sendSmartAutoHisn(sock, from) {
    const smartCategory = getSmartCategoryByTime();
    await sendHisnSequentialText(sock, from, smartCategory, Math.floor(Math.random() * 5));
}

// دالة عرض الفهرس المعالجة
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
        indexText += `💡 *خيارات التفعيل والطلب:*\n`;
        indexText += `• للتفعيل التلقائي الذكي على مدار الساعة: أرسل *.حصن تلقائي*\n`;
        indexText += `• لطلب باب معين بالتتابع: أرسل رقم الباب والدقائق (مثال: *.حصن 1 2د*).\n`;
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

        // 1. ميزة التفعيل التلقائي الذكي (.حصن تلقائي)
        if (args === 'تلقائي' || args === 'تلقائى' || args === 'الآلي' || args === 'الي') {
            if (autoHisnTimers[from]) clearInterval(autoHisnTimers[from]);

            await sock.sendMessage(from, { react: { text: '🔄', key: msg.key } });
            await sock.sendMessage(from, { 
                text: `✅ *تم تفعيل خدمة "حصن المسلم التلقائي" بنجاح!* 🌙✨\n\nسيتم إرسال أذكار مناسبة لوقتك الحالي (الصباح، المساء، النوم، الاستيقاظ) تلقائياً على مدار الساعة دون توقف.\n\n🛑 لإيقاف الخدمة أرسل: *.حصن وقف*` 
            }, { quoted: msg });

            // إرسال أول ذكر فوراً حسب التوقيت الحالي
            await sendSmartAutoHisn(sock, from);

            // جدولة الإرسال كل ساعتين تلقائياً دون توقف (120 دقيقة)
            autoHisnTimers[from] = setInterval(async () => {
                await sendSmartAutoHisn(sock, from);
            }, 120 * 60 * 1000);

            return true;
        }

        // 2. عرض الفهرس (.حصن فهرس)
        if (args.startsWith('فهرس') || args.startsWith('الفهرس') || args.startsWith('أبواب') || args.startsWith('ابواب')) {
            const pageMatch = args.match(/\d+/);
            const page = pageMatch ? parseInt(pageMatch[0]) : 1;
            await sendHisnIndex(sock, from, msg, page);
            return true;
        }

        // 3. إيقاف التكرار الدوري والتلقائي (.حصن وقف)
        if (args === 'وقف' || args === 'ايقاف' || args === 'إيقاف') {
            let stopped = false;
            if (activeHisnTimers[from]) {
                clearInterval(activeHisnTimers[from]);
                delete activeHisnTimers[from];
                delete hisnProgress[from];
                stopped = true;
            }
            if (autoHisnTimers[from]) {
                clearInterval(autoHisnTimers[from]);
                delete autoHisnTimers[from];
                stopped = true;
            }

            if (stopped) {
                await sock.sendMessage(from, { text: '🛑 تم إيقاف الإرسال التلقائي لأذكار حصن المسلم بنجاح.' }, { quoted: msg });
            } else {
                await sock.sendMessage(from, { text: 'ℹ️ لا يوجد إرسال تلقائي للأذكار مفعّل لديك.' }, { quoted: msg });
            }
            return true;
        }

        // 4. التكرار الدوري الترتيبي لِباب محدد (مثال: .حصن 1 2د)
        const matchMinutes = args.match(/(\d+)د/);
        if (matchMinutes) {
            const minutes = parseInt(matchMinutes[1]);
            if (minutes < 1) return true;

            const categoryMatch = args.match(/^(\d+)/);
            const categoryId = categoryMatch ? parseInt(categoryMatch[1]) : 1;

            if (activeHisnTimers[from]) clearInterval(activeHisnTimers[from]);

            hisnProgress[from] = { categoryId, currentIndex: 0 };

            await sock.sendMessage(from, { react: { text: '⏰', key: msg.key } });
            await sock.sendMessage(from, { text: `✅ تم تفعيل إرسال أذكار الباب رقم (${categoryId}) بالتتابع كل *${minutes}* دقيقة حتى اكتمال الأذكار.` }, { quoted: msg });

            const isCompletedFirst = await sendHisnSequentialText(sock, from, categoryId, 0);
            if (isCompletedFirst) {
                await sock.sendMessage(from, { text: `🎉 *تمت بحمد الله قراءة جميع أذكار هذا الباب بالكامل.*` });
                return true;
            }

            hisnProgress[from].currentIndex++;

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

        // 5. طلب باب محدد مفرداً (مثال: .حصن 1)
        const categoryNumber = parseInt(args);
        if (!isNaN(categoryNumber) && categoryNumber > 0) {
            await sock.sendMessage(from, { react: { text: '🛡️', key: msg.key } });
            await sendHisnSequentialText(sock, from, categoryNumber, 0);
            return true;
        }

        // 6. طلب عشوائي عند كتابة (.حصن) فقط
        await sock.sendMessage(from, { react: { text: '🛡️', key: msg.key } });
        await sendHisnSequentialText(sock, from, getSmartCategoryByTime(), 0);
        return true;
    }
    return false;
}
