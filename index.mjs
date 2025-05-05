// Import library yang dibutuhkan
import express from 'express';
import { pipeline, env } from '@xenova/transformers';

// Konfigurasi untuk menghindari download model di environment tertentu jika perlu
// env.allowLocalModels = false; // Uncomment jika hanya ingin pakai model dari Hugging Face Hub
// env.useBrowserCache = false; // Matikan cache browser jika perlu

const app = express();

// --- Kamus Gaul ---
// Tambahkan lebih banyak kata sesuai kebutuhan
const kamusGaul = {
    'saya': 'gue',
    'kamu': 'lu',
    'anda': 'lu',
    'dia': 'doi',
    'kami': 'kita orang',
    'kalian': 'kalian semua',
    'mereka': 'mereka itu',
    'adalah': 'itu',
    'tidak': 'nggak',
    'belum': 'belom',
    'sudah': 'udah',
    'ingin': 'pengen',
    'mau': 'pengen',
    'akan': 'bakal',
    'sedang': 'lagi',
    'bagaimana': 'gimana',
    'mengapa': 'kenapa',
    'kapan': 'kapan aja',
    'dimana': 'dimana aja',
    'apa': 'apaan',
    'siapa': 'sapose',
    'selamat pagi': 'met pagi',
    'selamat siang': 'met siang',
    'selamat sore': 'met sore',
    'selamat malam': 'met malem',
    'terima kasih': 'makasih',
    'sama-sama': 'yoi, sans',
    'maaf': 'sori',
    'tolong': 'bantuin dong',
    'uang': 'duit',
    'makan': 'mokat', // Hati-hati, konotasi bisa berbeda
    'minum': 'ngombe',
    'pergi': 'cabut',
    'datang': 'dateng',
    'rumah': 'basecamp',
    'teman': 'konco', 'temen',
    'pacar': 'gebetan', 'doi',
    'bekerja': 'gawe',
    'belajar': 'ngulik',
    'santai': 'sans',
    'sekali': 'banget',
    'sangat': 'banget',
    'pusing': 'pening',
    'bingung': 'galau',
    'senang': 'hepi',
    'sedih': 'mellow',
    // Tambahkan lebih banyak kata di sini...
};

// Fungsi untuk mengubah teks baku ke gaul
function ubahKeGaul(teks) {
    let teksGaul = teks;
    // Iterasi kamus dan ganti kata per kata (case-insensitive)
    for (const [baku, gaul] of Object.entries(kamusGaul)) {
        // Gunakan regex untuk mengganti semua kemunculan, case-insensitive
        // \b memastikan kita hanya mengganti kata utuh
        const regex = new RegExp(`\\b${baku}\\b`, 'gi');
        teksGaul = teksGaul.replace(regex, gaul);
    }
    return teksGaul;
}

// --- AI Model Loading ---
let generator;
let modelReady = false;

async function loadModel() {
    try {
        console.log('Mulai memuat model AI...');
        // Pilih model text-generation. 'Xenova/distilgpt2' cukup ringan.
        // Untuk hasil bhs Indonesia lebih baik, coba model multilingual atau yg di-fine-tune utk ID
        // Contoh lain: 'Xenova/gpt2', 'Xenova/bloom-560m' (lebih besar)
        generator = await pipeline('text-generation', 'Xenova/opt-350m');
        console.log('Model AI berhasil dimuat!');
        modelReady = true;
    } catch (error) {
        console.error('Gagal memuat model AI:', error);
        // Handle error, mungkin coba lagi atau beritahu status error
    }
}

// Panggil fungsi loadModel saat server start
loadModel();

// --- Route Chatbot ---
app.get('/chat', async (req, res) => {
    const pesanPengguna = req.query.pesan; // Ambil pesan dari query ?pesan=...

    if (!pesanPengguna) {
        return res.status(400).json({ error: 'Query parameter "pesan" dibutuhkan, Bos!' });
    }

    if (!modelReady || !generator) {
        return res.status(503).json({ error: 'Model AI belom siap nih, coba bentar lagi ya.' });
    }

    console.log(`[Pesan Masuk]: ${pesanPengguna}`);

    try {
        // Hasilkan teks menggunakan model AI
        // max_length bisa disesuaikan
        // num_return_sequences=1 berarti hanya 1 jawaban
        let result = await generator(pesanPengguna, {
            max_new_tokens: 50, // Batasi panjang token baru yg dihasilkan
            num_return_sequences: 1,
            // Parameter lain bisa ditambahkan: temperature, top_k, top_p, etc.
            // temperature: 0.7, // Membuat jawaban sedikit lebih random/kreatif (makin tinggi makin random)
            // top_k: 50,
        });

        // Ekstrak teks yang dihasilkan
        // Struktur output bisa bervariasi tergantung model, cek dokumentasi/log
        let jawabanAI = '';
        if (result && result.length > 0 && result[0].generated_text) {
             // Seringkali model mengulang input, kita coba hilangkan:
             if (result[0].generated_text.startsWith(pesanPengguna)) {
                 jawabanAI = result[0].generated_text.substring(pesanPengguna.length).trim();
             } else {
                 jawabanAI = result[0].generated_text.trim();
             }
             // Kadang masih ada sisa prompt tidak jelas, bersihkan jika perlu
             jawabanAI = jawabanAI.split('\n')[0]; // Ambil baris pertama saja
        } else {
            jawabanAI = "Aduh, sorry nih, AI-nya lagi nge-blank."; // Jawaban default jika AI gagal
        }

        console.log(`[Jawaban AI Asli]: ${jawabanAI}`);

        // Ubah jawaban AI ke bahasa gaul
        const jawabanGaul = ubahKeGaul(jawabanAI);
        console.log(`[Jawaban Gaul]: ${jawabanGaul}`);

        // Kirim respons dalam format JSON
        res.json({
            pesan_kamu: pesanPengguna,
            jawaban_gaul_bot: jawabanGaul,
        });

    } catch (error) {
        console.error('Error pas proses chat:', error);
        res.status(500).json({ error: 'Waduh, ada error nih di server, ntar coba lagi.' });
    }
});

// Route dasar untuk cek server jalan
app.get('/', (req, res) => {
    res.send('Server Chatbot Gaul Aktif! Coba endpoint /chat?pesan=Halo');
});

// Ekspor app untuk Vercel
export default app;
