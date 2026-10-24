import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set, get, child } from 'firebase/database';
import fs from 'fs';
import path from 'path';

const firebaseConfig = {
    databaseURL: "https://salaty-ed58a-default-rtdb.firebaseio.com"
};

const firebaseApp = initializeApp(firebaseConfig);
export const db = getDatabase(firebaseApp);

export const AUTH_DIR = path.join(process.cwd(), 'prayer_bot_auth');
if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
}

export async function restoreSubscribersFromFirebase() {
    try {
        const dbRef = ref(db);
        const snapshot = await get(child(dbRef, 'subscribers'));
        const subscribers = snapshot.exists() ? snapshot.val() || {} : {};
        
        const hadithSnap = await get(child(dbRef, 'hadith_subscribers'));
        const hadithSubscribers = hadithSnap.exists() ? hadithSnap.val() || {} : {};

        return { subscribers, hadithSubscribers };
    } catch (e) {
        console.log("❌ خطأ جلب المشتركين من Firebase:", e.message);
        return { subscribers: {}, hadithSubscribers: {} };
    }
}

export async function saveSubscribersToFirebase(subscribers, hadithSubscribers) {
    try {
        await set(ref(db, 'subscribers'), subscribers);
        await set(ref(db, 'hadith_subscribers'), hadithSubscribers);
    } catch (e) {
        console.log("❌ خطأ حفظ المشتركين في Firebase:", e.message);
    }
}

export async function restoreAuthFromFirebase() {
    try {
        const dbRef = ref(db);
        const snapshot = await get(child(dbRef, 'auth_session'));
        if (snapshot.exists()) {
            const authFiles = snapshot.val();
            if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });
            for (const [safeFilename, contentBase64] of Object.entries(authFiles)) {
                const filename = safeFilename.replace(/_DOT_/g, '.');
                fs.writeFileSync(path.join(AUTH_DIR, filename), Buffer.from(contentBase64, 'base64'));
            }
        }
    } catch (e) {
        console.log("❌ خطأ استرجاع الجلسة من Firebase:", e.message);
    }
}

export async function saveAuthToFirebase() {
    try {
        if (!fs.existsSync(AUTH_DIR)) return;
        const files = fs.readdirSync(AUTH_DIR);
        const authData = {};
        for (const file of files) {
            const filePath = path.join(AUTH_DIR, file);
            if (fs.statSync(filePath).isFile()) {
                authData[file.replace(/\./g, '_DOT_')] = fs.readFileSync(filePath).toString('base64');
            }
        }
        await set(ref(db, 'auth_session'), authData);
    } catch (e) {
        console.log("❌ خطأ حفظ الجلسة في Firebase:", e.message);
    }
}
