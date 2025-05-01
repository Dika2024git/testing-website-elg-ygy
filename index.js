const express = require('express');
const Fuse = require('fuse.js');
const chatData = require('./chatData.json');

const app = express();

// --- State Konteks (Tetap sederhana untuk demo) ---
let currentContext = null;
let lastUserMessage = null; // Simpan pesan terakhir untuk pembersihan konteks

// --- Urutkan Aturan berdasarkan Prioritas (Descending) ---
const sortedChatData = chatData
    .filter(rule => rule.priority >= 0) // Abaikan rule data seperti 'suggestions'
    .sort((a, b) => b.priority - a.priority); // Urutkan dari prioritas tertinggi ke terendah

// --- Inisialisasi Fuse.js ---
const allKeywordsData = sortedChatData.flatMap(item =>
    item.keywords.map(kw => ({ keyword: kw, id: item.id, priority: item.priority }))
);

const fuseOptions = {
    includeScore: true,
    threshold: 0.4, // Sesuaikan jika perlu
    keys: ['keyword'],
    ignoreLocation: true, // Cari di seluruh string keyword
    distance: 100, // Parameter untuk algoritma pencarian
};

const fuse = new Fuse(allKeywordsData, fuseOptions);

// --- Fungsi Bantuan ---
function getRandomElement(arr) {
    if (!arr || arr.length === 0) return null;
    return arr[Math.floor(Math.random() * arr.length)];
}

function getGreetingByTime() {
    const hour = new Date().getHours();
    if (hour >= 4 && hour < 11) return "Selamat pagi";
    if (hour >= 11 && hour < 15) return "Selamat siang";
    if (hour >= 15 && hour < 18) return "Selamat sore";
    return "Selamat malam";
}

const suggestionData = chatData.find(item => item.id === 'suggestions')?.data || [];

// --- Fungsi Dynamic Answers ---
const dynamicAnswerFunctions = {
    sapaanWaktuAkurat: () => {
        // Hanya mengembalikan sapaan waktu yang akurat
        return `${getGreetingByTime()}! Ada yang bisa dibantu?`;
    },
    sapaanWaktuUmum: () => {
        // Menggabungkan sapaan waktu dengan jawaban dasar dari rule 'sapaanUmum'
        const baseAnswers = chatData.find(item => item.id === 'sapaanUmum')?.answers;
        const randomBaseAnswer = getRandomElement(baseAnswers) || "Ada yang bisa saya bantu?";
        // Hindari pengulangan sapaan waktu jika base answer sudah mengandungnya
        if (/pagi|siang|sore|malam/.test(randomBaseAnswer.toLowerCase())) {
            return randomBaseAnswer;
        }
        return `${getGreetingByTime()}! ${randomBaseAnswer}`;
    },
    fallbackDenganSaran: () => {
        const baseFallbackAnswers = chatData.find(item => item.id === 'fallback')?.answers;
        let reply = getRandomElement(baseFallbackAnswers) || "Maaf, saya tidak mengerti.";

        // Tambahkan saran secara acak
        if (suggestionData.length > 0) {
            const suggestions = [];
            const count = Math.min(3, suggestionData.length); // Ambil maks 3 saran
            const tempSuggestions = [...suggestionData]; // Salin array agar bisa diacak tanpa mengubah asli
            for (let i = 0; i < count; i++) {
                const randomIndex = Math.floor(Math.random() * tempSuggestions.length);
                suggestions.push(`'${tempSuggestions.splice(randomIndex, 1)[0]}'`);
            }
            reply += ` Mungkin Anda bisa mencoba: ${suggestions.join(', ')}?`;
        }
        return reply;
    }
};

// --- Rute Chatbot ---
app.get('/chat', (req, res) => {
    const userMessage = req.query.message;

    if (!userMessage) {
        return res.status(400).json({ error: 'Parameter "message" diperlukan.' });
    }

    const normalizedMessage = userMessage.toLowerCase().trim();
    let reply = null; // Default reply null
    let matchedRule = null;
    let matchType = 'none'; // 'exact', 'fuse', 'fallback'
    let fuseMatchDetails = null;

    console.log(`\n--- Request Baru ---`);
    console.log(`Timestamp: ${new Date().toISOString()}`);
    console.log(`Pesan Diterima: "${userMessage}" (Normalized: "${normalizedMessage}")`);
    console.log(`Konteks Saat Ini: ${currentContext}`);

    // --- Pembersihan Konteks Otomatis ---
    // Jika pesan baru berbeda dari sebelumnya DAN ada konteks, hapus konteks
    // Ini mencegah konteks terjebak jika pengguna tiba-tiba ganti topik
    if (currentContext && lastUserMessage && normalizedMessage !== lastUserMessage.toLowerCase().trim()) {
        console.log(`Pesan berubah & ada konteks (${currentContext}), konteks dihapus.`);
        currentContext = null;
    }
    lastUserMessage = userMessage; // Simpan pesan saat ini untuk cek berikutnya


    // --- Pencarian Kecocokan ---
    // 1. Cari Kecocokan Exact Keyword (Prioritaskan yang lebih panjang)
    let exactMatchFound = false;
    const potentialExactMatches = [];
    for (const rule of sortedChatData) {
        // Cari keyword terpanjang dari rule ini yang ada di pesan user
        const matchingKeywords = rule.keywords
            .filter(kw => normalizedMessage.includes(kw.toLowerCase()))
            .sort((a, b) => b.length - a.length); // Urutkan keyword cocok dari terpanjang

        if (matchingKeywords.length > 0) {
            potentialExactMatches.push({ rule, matchedKeyword: matchingKeywords[0] });
        }
    }

    // Pilih exact match terbaik (dari rule prioritas tertinggi, dengan keyword terpanjang jika prioritas sama)
    if (potentialExactMatches.length > 0) {
        potentialExactMatches.sort((a, b) => {
            if (b.rule.priority !== a.rule.priority) {
                return b.rule.priority - a.rule.priority; // Prioritas tertinggi dulu
            }
            return b.matchedKeyword.length - a.matchedKeyword.length; // Keyword terpanjang dulu jika prioritas sama
        });

        const bestExactMatch = potentialExactMatches[0];

        // Validasi Konteks untuk Exact Match Terbaik
        if (!bestExactMatch.rule.requiredContext || bestExactMatch.rule.requiredContext === currentContext) {
            matchedRule = bestExactMatch.rule;
            matchType = 'exact';
            exactMatchFound = true;
            console.log(`Exact Match Ditemukan: Rule ID '${matchedRule.id}', Keyword '${bestExactMatch.matchedKeyword}', Prioritas ${matchedRule.priority}`);
        } else {
             console.log(`Exact Match Rule ID '${bestExactMatch.rule.id}' dilewati karena konteks (membutuhkan: ${bestExactMatch.rule.requiredContext}, saat ini: ${currentContext})`);
        }
    }


    // 2. Jika tidak ada Exact Match, Coba Fuse.js
    if (!exactMatchFound) {
        const fuseResult = fuse.search(normalizedMessage);
        console.log(`Fuse.js results: ${fuseResult.length > 0 ? fuseResult.slice(0, 3).map(r => `${r.item.id}(${r.score.toFixed(2)})`).join(', ') : 'None'}`);

        if (fuseResult.length > 0) {
            // Filter hasil Fuse berdasarkan threshold DAN konteks yang valid
            const validFuseMatches = fuseResult
                .filter(r => r.score <= fuseOptions.threshold) // Filter berdasarkan skor
                .map(r => ({ ...r, rule: sortedChatData.find(rule => rule.id === r.item.id) })) // Tambahkan data rule lengkap
                .filter(r => r.rule && (!r.rule.requiredContext || r.rule.requiredContext === currentContext)); // Filter berdasarkan konteks

            if (validFuseMatches.length > 0) {
                // Pilih hasil Fuse terbaik (skor terendah, prioritas tertinggi jika skor sama)
                 validFuseMatches.sort((a, b) => {
                     if (a.score !== b.score) {
                         return a.score - b.score; // Skor terendah dulu
                     }
                     return b.rule.priority - a.rule.priority; // Prioritas tertinggi jika skor sama
                 });

                 const bestFuseMatch = validFuseMatches[0];
                 matchedRule = bestFuseMatch.rule;
                 matchType = 'fuse';
                 fuseMatchDetails = {
                     original: normalizedMessage,
                     corrected: bestFuseMatch.item.keyword,
                     score: bestFuseMatch.score,
                 };
                 console.log(`Fuse Match Dipilih: Rule ID '${matchedRule.id}', Keyword Koreksi '${fuseMatchDetails.corrected}', Skor ${fuseMatchDetails.score.toFixed(3)}, Prioritas ${matchedRule.priority}`);
            } else {
                console.log("Hasil Fuse.js ada, tapi tidak memenuhi threshold atau konteks.");
            }
        }
    }

    // 3. Jika Masih Tidak Ada Match, Gunakan Fallback Rule
    if (!matchedRule) {
        matchedRule = sortedChatData.find(rule => rule.id === 'fallback');
        if (matchedRule) {
             matchType = 'fallback';
             console.log("Tidak ada match spesifik, menggunakan Fallback Rule.");
             // Hapus konteks jika fallback dipicu (kecuali fallback memang butuh konteks, tapi di sini tidak)
             if (currentContext && !matchedRule.requiredContext) {
                 console.log(`Konteks (${currentContext}) dihapus karena fallback.`);
                 currentContext = null;
             }
        } else {
            // Fallback darurat jika rule 'fallback' tidak ditemukan
            reply = "Maaf, terjadi sedikit masalah pada sistem saya.";
             console.error("ERROR: Fallback rule 'fallback' tidak ditemukan di chatData.json!");
             matchType = 'error';
             currentContext = null; // Reset konteks jika error
        }

    }

    // --- Hasilkan Jawaban & Atur Konteks ---
    if (matchedRule && matchType !== 'error') {
        // Hasilkan Jawaban
        if (matchedRule.dynamicAnswer && dynamicAnswerFunctions[matchedRule.dynamicAnswer]) {
            try {
                reply = dynamicAnswerFunctions[matchedRule.dynamicAnswer]();
                console.log(`Dynamic Answer dari fungsi '${matchedRule.dynamicAnswer}' untuk Rule ID '${matchedRule.id}'`);
            } catch (error) {
                console.error(`Error menjalankan dynamicAnswer '${matchedRule.dynamicAnswer}':`, error);
                reply = getRandomElement(matchedRule.answers) || "Maaf, sepertinya ada sedikit gangguan."; // Fallback jika dynamic error
            }
        } else {
            reply = getRandomElement(matchedRule.answers);
             console.log(`Static Answer dipilih untuk Rule ID '${matchedRule.id}'`);
        }

        // Atur atau Hapus Konteks (hanya jika bukan fallback yang menghapusnya)
        if (matchType !== 'fallback') {
            if (matchedRule.setContext) {
                currentContext = matchedRule.setContext;
                console.log(`Konteks diatur ke: ${currentContext}`);
            } else if (matchedRule.clearContext) {
                console.log(`Konteks dihapus oleh Rule ID '${matchedRule.id}' (sebelumnya: ${currentContext})`);
                currentContext = null;
            }
             // Jika rule yang cocok *tidak* mengubah konteks, dan konteks sebelumnya ada, biarkan konteksnya
             // (kecuali jika pembersihan otomatis di awal sudah menghapusnya)
             else if(currentContext) {
                 console.log(`Konteks (${currentContext}) dipertahankan karena Rule ID '${matchedRule.id}' tidak mengubahnya.`);
             }
        }
    }

     // --- Kirim Respons ---
     console.log(`Jawaban Dikirim: "${reply}"`);
     console.log(`Konteks Akhir: ${currentContext}`);
     console.log(`Match Type: ${matchType}`);
     console.log(`--- Akhir Request ---`);

     res.json({
         query: userMessage,
         reply: reply,
         match_details: {
             type: matchType,
             rule_id: matchedRule ? matchedRule.id : null,
             priority: matchedRule ? matchedRule.priority : null,
             context_before: req.query.debug ? (matchType === 'exact' || matchType === 'fuse' ? (matchedRule?.requiredContext || 'none') : 'N/A') : undefined, // Tampilkan konteks yg dibutuhkan rule (jika debug)
             context_after: currentContext,
             fuse_info: matchType === 'fuse' ? fuseMatchDetails : null
         }
     });
});

// Rute default
app.get('/', (req, res) => {
    res.send('Server Chatbot Express.js (v2) Aktif! Gunakan endpoint /chat?message=pesan_anda');
});

module.exports = app;