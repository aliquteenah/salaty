import axios from 'axios';
import { db } from '../config/firebase.js';
import { ref, set, get, child, remove } from 'firebase/database';

const activeHisnTimers = {};
const hisnProgress = {};
export const autoHisnSubscribers = new Map();

// دالة مصفوفة الأبواب الذكية حسب التوقيت المحلي لمكة المكرمة
function getSmartCategoriesByTime() {
    const localHourStr = new Date().toLocaleTimeString('en-GB', { 
        timeZone: 'Asia/Riyadh', 
        hour: '2-digit', 
        hour12: false 
    });
    
    const currentHour = parseInt(localHourStr, 10);

    // الفجر والصباح الباكر (من 4:00 ص إلى 7:00 ص)
    if (currentHour >= 4 && currentHour < 7) {
        return [1, 28, 30, 31];
    }
    // الصباح (من 7:00 ص إلى 12:00 ظ)
    else if (currentHour >= 7 && currentHour < 12) {
        return [40, 25, 27, 9];
    }
    // الظهيرة والعصر (من 12:00 ظ إلى 4:30 م)
    else if (currentHour >= 12 && currentHour < 16.5) {
        return [25, 27, 35, 60, 70, 80, 90, 100];
    }
    // المساء (من 4:30 م إلى 9:00 م)
    else if (currentHour >= 16.5 && currentHour < 21) {
        return [40, 35, 28, 60];
    }
    // الليل والنوم (من 9:00 م إلى 4:00 ص)
    else {
        return [50, 55, 60, 30, 31];
    }
}

// دالة حفظ واستعادة الاشتراكات والتقدم في Firebase
async function saveAutoHisnSubscribers(jid, minutes, categoryId = null, index = 0) {
    try {
        const safeJid = jid.replace(/\./g, '_DOT_');
        await set(ref(db, `auto_hisn_subscribers/${safeJid}`), { 
            minutes, 
            categoryId, 
            index, 
            updatedAt: Date.now() 
        });
    } catch (e) {
        console.error('خطأ حفظ حصن تلقائي في Firebase:', e.message);
    }
}

async function removeAutoHisnSubscriber(jid) {
    try {
        const safeJid = jid.replace(/\./g, '_DOT_');
        await remove(ref(db, `auto_hisn_subscribers/${safeJid}`));
    } catch (e) {
        console.error('خطأ حذف حصن تلقائي من Firebase:', e.message);
    }
}

export async function restoreAutoHisnSubscribers(sock) {
    try {
        const dbRef = ref(db);
        const snapshot = await get(child(dbRef, 'auto_hisn_subscribers'));
        if (snapshot.exists()) {
            const data = snapshot.val();
            for (const [safeJid, info] of Object.entries(data)) {
                const jid = safeJid.replace(/_DOT_/g, '.');
                startAutoTimer(sock, jid, info.minutes || 120, false, info.categoryId, info.index || 0);
            }
            console.log('✅ تم استعادة اشتراكات حصن المسلم التلقائية من Firebase بنجاح.');
        }
    } catch (e) {
        console.error('خطأ استعادة حصن تلقائي من Firebase:', e.message);
    }
}

// دالة جلب وإرسال الذكر بالتتابع
async function sendHisnSequentialText(sock, from, categoryId, index = 0) {
    try {
        const textRes = await axios.get(`https://www.hisnmuslim.com/api/ar/${categoryId}.json`, { timeout: 12000 });
        const categoryKey = Object.keys(textRes.data)[0];
        const azkarList = textRes.data[categoryKey];

        if (!azkarList || azkarList.length === 0) {
            return { isCompleted: true, azkarList: [] };
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
│ 🔁 *التكرار المطلوب:* ${repeatCount} مرة
*╯ ───═┅─┅─┅═─── ╰*`;

        await sock.sendMessage(from, { text: cardText });

        const isCompleted = (currentIndex + 1 >= azkarList.length);
        return { isCompleted, total: azkarList.length };
    } catch (e) {
        console.error('Hisn Text API Error:', e.message);
        return { isCompleted: false, error: true };
    }
}

// دالة المحرك التلقائي الذهبي للمتابعة بين الأبواب
export async function processAutoHisnStep(sock, from) {
    let state = autoHisnSubscribers.get(from) || {};
    
    // إذا لم يحدد باب، نختار باباً مناسباً لوقت مكة المكرمة
    if (!state.categoryId) {
        const categories = getSmartCategoriesByTime();
        state.categoryId = categories[Math.floor(Math.random() * categories.length)];
        state.index = 0;
    }

    const result = await sendHisnSequentialText(sock, from, state.categoryId, state.index);

    if (result.isCompleted) {
        // إذا اكتمل الباب الحالي، نختار الباب التالي لمواصلة السلسلة
        const categories = getSmartCategoriesByTime();
        let nextCategory = categories[Math.floor(Math.random() * categories.length)];
        
        // تجنب اختيار نفس الباب فوراً إن أمكن
        if (categories.length > 1 && nextCategory === state.categoryId) {
            nextCategory = categories.find(c => c !== state.categoryId) || nextCategory;
        }

        state.categoryId = nextCategory;
        state.index = 0;
    } else if (!result.error) {
        // الانقال للذكر التالي داخل نفس الباب
        state.index++;
    }

    autoHisnSubscribers.set(from, state);
    await saveAutoHisnSubscribers(from, state.minutes, state.categoryId, state.index);
}

// دالة بدء التكرار التلقائي الدوري
function startAutoTimer(sock, from, minutes, sendInitial = true, initialCategory = null, initialIndex = 0) {
    if (autoHisnTimers[from]) clearInterval(autoHisnTimers[from]);

    const state = {
        minutes,
        categoryId: initialCategory,
        index: initialIndex
    };
    autoHisnSubscribers.set(from, state);

    if (sendInitial) {
        processAutoHisnStep(sock, from).catch(() => {});
    }

    autoHisnTimers[from] = setInterval(async () => {
        try {
            await processAutoHisnStep(sock, from);
        } catch (e) {
            console.error('خطأ إرسال الحصن التلقائي:', e.message);
        }
    }, minutes * 60 * 1000);

    state.timer = autoHisnTimers[from];
    autoHisnSubscribers.set(from, state);
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
        indexText += `• للتفعيل التلقائي المتسلسل: أرسل *.حصن تلقائي* (أو *.حصن تلقائي 30د*)\n`;
        indexText += `• لطلب أذكار باب معين بالتتابع: أرسل رقم الباب والدقائق (مثال: *.حصن 1 2د*).\n`;
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

        // 1. ميزة التفعيل التلقائي الذكي المتسلسل (.حصن تلقائي 30د)
        if (args.startsWith('تلقائي') || args.startsWith('تلقائى') || args.startsWith('الآلي') || args.startsWith('الي')) {
            const matchMinutes = args.match(/(\d+)د/);
            const minutes = matchMinutes ? parseInt(matchMinutes[1], 10) : 120;

            startAutoTimer(sock, from, minutes, true);

            await sock.sendMessage(from, { react: { text: '🔄', key: msg.key } });
            await sock.sendMessage(from, { 
                text: `✅ *تم تفعيل خدمة "حصن المسلم التلقائي المتسلسل" بنجاح!* 🌙✨\n\nسيتم إرسال أذكار الباب بالترتيب حتى يكتمَل بالكامل، ثم ينتقل تلقائياً للباب التالي حسب توقيتك كل *${minutes}* دقيقة دون توقف.\n\n🛑 لإيقاف الخدمة أرسل: *.حصن وقف*` 
            }, { quoted: msg });

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

            if (autoHisnSubscribers.has(from)) {
                const state = autoHisnSubscribers.get(from);
                if (state && state.timer) clearInterval(state.timer);
                autoHisnSubscribers.delete(from);
                delete autoHisnTimers[from];
                await removeAutoHisnSubscriber(from);
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

            const firstRes = await sendHisnSequentialText(sock, from, categoryId, 0);
            if (firstRes.isCompleted) {
                await sock.sendMessage(from, { text: `🎉 *تمت بحمد الله قراءة جميع أذكار هذا الباب بالكامل.*` });
                return true;
            }

            hisnProgress[from].currentIndex++;

            activeHisnTimers[from] = setInterval(async () => {
                const prog = hisnProgress[from];
                if (!prog) return;

                const res = await sendHisnSequentialText(sock, from, prog.categoryId, prog.currentIndex);

                if (res.isCompleted) {
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
        await processAutoHisnStep(sock, from);
        return true;
    }
    return false;
}
