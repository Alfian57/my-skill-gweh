import type { Language, Skill } from './catalog.js';
import { resolveStack } from './stack.js';

export interface Localized {
  id: string;
  en: string;
}

export interface GuideSection {
  title: Localized;
  paragraphs?: Localized[];
  bullets: Localized[];
}

export interface GuideTemplate {
  sections: GuideSection[];
  example?: {
    title: Localized;
    code: string;
    language?: string;
    stacks?: string[];
  };
}

export const guides: Record<Skill, GuideTemplate> = {
  quality: {
    sections: [
      {
        title: { id: 'Batas tanggung jawab', en: 'Responsibility boundaries' },
        paragraphs: [
          {
            id: 'Perubahan harus mengikuti pola repository yang sudah terbukti. Periksa file tetangga, abstraksi yang tersedia, dan pengujian terkait sebelum memilih struktur baru.',
            en: 'Changes should follow established repository patterns. Inspect sibling files, available abstractions, and related tests before choosing a new structure.',
          },
        ],
        bullets: [
          {
            id: 'Satu modul memiliki satu alasan utama untuk berubah. Pisahkan parsing, aturan domain, akses data, dan penyajian ketika batasnya memang berbeda.',
            en: 'Give each module one primary reason to change. Separate parsing, domain rules, data access, and presentation when their boundaries genuinely differ.',
          },
          {
            id: 'Jangan menambah lapisan, service, base class, atau folder arsitektur hanya untuk memindahkan beberapa baris kode.',
            en: 'Do not add a layer, service, base class, or architecture folder just to move a few lines of code.',
          },
          {
            id: 'Refactor bagian yang diperlukan untuk perubahan aktif; catat temuan pada file lain tanpa memperluas scope.',
            en: 'Refactor only what the active change requires; note unrelated findings without expanding the task scope.',
          },
        ],
      },
      {
        title: { id: 'Keterbacaan dan ukuran', en: 'Readability and size' },
        bullets: [
          {
            id: 'Gunakan nama yang menyatakan maksud dan tipe yang spesifik. Hindari singkatan lokal, nilai sentinel tersembunyi, serta komentar yang sekadar mengulang kode.',
            en: 'Use intention-revealing names and specific types. Avoid obscure local abbreviations, hidden sentinel values, and comments that merely repeat the code.',
          },
          {
            id: 'Utamakan abstraksi yang sudah dipakai repository; generalisasi baru perlu lebih dari satu kebutuhan nyata atau batas domain yang jelas.',
            en: 'Prefer abstractions already used by the repository; a new generalization needs multiple real use cases or a clear domain boundary.',
          },
        ],
      },
      {
        title: { id: 'Kebenaran dan kegagalan', en: 'Correctness and failures' },
        bullets: [
          {
            id: 'Validasi input di batas sistem sebelum dipakai oleh domain atau persistence. Jangan menganggap tipe compile-time sebagai validasi data runtime.',
            en: 'Validate input at system boundaries before using it in domain logic or persistence. Do not treat compile-time types as runtime data validation.',
          },
          {
            id: 'Tangani kegagalan secara eksplisit: pertahankan konteks error, berikan respons yang sesuai, dan jangan menelan exception tanpa alasan.',
            en: 'Handle failures explicitly: preserve error context, return an appropriate response, and do not swallow exceptions without a reason.',
          },
          {
            id: 'Jangan mencatat credential, token, payload sensitif, atau data personal yang tidak diperlukan untuk diagnosis.',
            en: 'Do not log credentials, tokens, sensitive payloads, or personal data that is not needed for diagnosis.',
          },
        ],
      },
    ],
  },
  docs: {
    sections: [
      {
        title: { id: 'Dokumentasikan kondisi nyata', en: 'Document present behavior' },
        bullets: [
          {
            id: 'Perbarui dokumen pemilik ketika perubahan mengubah perilaku, kontrak, setup, operasi, atau cara verifikasi.',
            en: 'Update the owning document when a change alters behavior, contracts, setup, operations, or verification.',
          },
          {
            id: 'Pisahkan kondisi saat ini dari target atau rencana. Gunakan label status dan bukti source agar rencana tidak terbaca sebagai fitur yang sudah tersedia.',
            en: 'Separate current behavior from targets or plans. Label status and cite source evidence so plans are not mistaken for implemented features.',
          },
          {
            id: 'Jelaskan alasan dan batasan aturan penting; hindari daftar slogan yang tidak membantu keputusan implementasi.',
            en: 'Explain the reasons and boundaries of important rules; avoid slogans that do not help implementation decisions.',
          },
          {
            id: 'Gunakan contoh dari pola yang benar-benar ada. Tandai contoh konseptual sebagai ilustrasi, bukan kontrak repository.',
            en: 'Use examples from patterns that actually exist. Mark conceptual examples as illustrations, not repository contracts.',
          },
        ],
      },
      {
        title: { id: 'Source of truth dan pemeliharaan', en: 'Sources of truth and maintenance' },
        bullets: [
          {
            id: 'Satu fakta memiliki satu dokumen pemilik; dokumen lain menautkan ke sana alih-alih menggandakan isi yang mudah berbeda.',
            en: 'Give each fact one owning document; other documents link to it instead of duplicating content that can drift.',
          },
          {
            id: 'Tautkan ke path relatif yang valid dan gunakan nama file dengan makna jelas.',
            en: 'Link to valid relative paths and use filenames with clear meaning.',
          },
          {
            id: 'Hapus atau tandai informasi usang ketika bukti implementasi berubah. Jangan mempertahankan instruksi hanya karena pernah benar.',
            en: 'Remove or mark stale information when implementation evidence changes. Do not keep instructions merely because they were once true.',
          },
          {
            id: 'Jangan menyalin nilai `.env`, credential, atau data pribadi ke dokumentasi; gunakan nama variabel dan placeholder aman bila perlu.',
            en: 'Never copy `.env` values, credentials, or personal data into documentation; use variable names and safe placeholders when needed.',
          },
        ],
      },
      {
        title: { id: 'Contoh perubahan', en: 'Change example' },
        bullets: [
          {
            id: 'Perubahan kontrak API memperbarui referensi kontrak dan tes terkait, bukan hanya catatan release.',
            en: 'An API contract change updates its contract reference and related tests, not only release notes.',
          },
          {
            id: 'Perubahan perintah setup memperbarui langkah onboarding dan environment yang diperlukan.',
            en: 'A setup-command change updates onboarding steps and required environment information.',
          },
        ],
      },
    ],
  },
  contracts: {
    sections: [
      {
        title: { id: 'Kontrak dan kompatibilitas', en: 'Contracts and compatibility' },
        bullets: [
          {
            id: 'Sebelum mengubah endpoint, event, schema, atau file format, cari seluruh pemanggil dan tes yang bergantung padanya.',
            en: 'Before changing an endpoint, event, schema, or file format, find all callers and tests that depend on it.',
          },
          {
            id: 'Pertahankan nama field, status/error semantics, format tanggal, pagination, dan bentuk respons kecuali perubahan kontrak memang diminta.',
            en: 'Preserve field names, status/error semantics, date formats, pagination, and response shapes unless a contract change is requested.',
          },
          {
            id: 'Perubahan database harus mempertimbangkan data lama, urutan deploy, rollback, dan proses yang membaca schema tersebut.',
            en: 'Database changes must account for existing data, deployment order, rollback, and processes that read the schema.',
          },
          {
            id: 'Jangan memperluas hak akses, ownership, tenant scope, atau visibility hanya untuk membuat alur baru lebih mudah.',
            en: 'Do not broaden permissions, ownership, tenant scope, or visibility merely to simplify a new flow.',
          },
        ],
      },
      {
        title: {
          id: 'Validasi, otorisasi, dan privasi',
          en: 'Validation, authorization, and privacy',
        },
        bullets: [
          {
            id: 'Validasi data tidak tepercaya di server pada batas input; client-side validation hanya membantu pengalaman pengguna.',
            en: 'Validate untrusted data on the server at the input boundary; client-side validation only improves user experience.',
          },
          {
            id: 'Periksa otorisasi pada setiap operasi baca dan tulis terhadap resource yang benar, bukan hanya menyembunyikan tombol UI.',
            en: 'Check authorization on every resource read and write; hiding a UI button is not authorization.',
          },
          {
            id: 'Kembalikan hanya field yang diperlukan oleh pemanggil. Audit log menyimpan metadata minimum, bukan rahasia atau payload penuh.',
            en: 'Return only fields the caller needs. Audit logs store minimal metadata, not secrets or full payloads.',
          },
          {
            id: 'Gunakan transaksi dan idempotensi saat beberapa perubahan harus berhasil sebagai satu unit atau callback dapat diulang.',
            en: 'Use transactions and idempotency when multiple changes must succeed as a unit or callbacks may be retried.',
          },
        ],
      },
      {
        title: { id: 'Perubahan kontrak', en: 'Changing a contract' },
        bullets: [
          {
            id: 'Nyatakan siapa yang terdampak, field atau perilaku apa yang berubah, dan strategi kompatibilitasnya.',
            en: 'State who is affected, which fields or behavior change, and the compatibility strategy.',
          },
          {
            id: 'Tambahkan tes untuk akses yang diizinkan, ditolak, dan data yang tidak boleh bocor.',
            en: 'Add tests for allowed access, denied access, and data that must not leak.',
          },
        ],
      },
    ],
  },
  testing: {
    sections: [
      {
        title: { id: 'Petakan perilaku sebelum menguji', en: 'Map behavior before testing' },
        bullets: [
          {
            id: 'Temukan tes terdekat, setup fixture, fake, factory, dan helper yang sudah digunakan sebelum menambah pola baru.',
            en: 'Find nearby tests, fixtures, fakes, factories, and helpers before adding a new pattern.',
          },
          {
            id: 'Uji hasil yang terlihat atau kontrak yang dijanjikan, bukan detail implementasi yang bebas berubah.',
            en: 'Test observable outcomes and promised contracts, not implementation details that may change freely.',
          },
          {
            id: 'Untuk bug, buat skenario yang gagal sebelum perbaikan atau bukti lain yang menunjukkan regresi telah tertutup.',
            en: 'For a bug, add a scenario that fails before the fix or other evidence that the regression is covered.',
          },
          {
            id: 'Jangan menghapus atau melemahkan tes untuk membuat suite lulus tanpa memperbaiki perilaku.',
            en: 'Do not delete or weaken tests just to make the suite pass without fixing behavior.',
          },
        ],
      },
      {
        title: { id: 'Cakupan kasus', en: 'Case coverage' },
        bullets: [
          {
            id: 'Uji jalur normal, batas nilai, data kosong, input invalid, dan kegagalan dependency yang relevan.',
            en: 'Cover the normal path, boundaries, empty data, invalid input, and relevant dependency failures.',
          },
          {
            id: 'Untuk akses, uji pemilik yang benar, pengguna lain, dan pengguna tanpa autentikasi sesuai kontrak.',
            en: 'For access control, test the rightful owner, another user, and unauthenticated access as required by the contract.',
          },
          {
            id: 'Untuk UI data, periksa loading, empty, error, dan dataset besar jika komponen mendukung kondisi tersebut.',
            en: 'For data UI, check loading, empty, error, and large datasets when the component supports those states.',
          },
          {
            id: 'Pastikan tes tidak bergantung pada urutan, waktu nyata, network luar, atau data lokal yang tidak dikontrol.',
            en: 'Ensure tests do not depend on ordering, wall-clock time, external network, or uncontrolled local data.',
          },
        ],
      },
      {
        title: { id: 'Verifikasi dan laporan', en: 'Verification and reporting' },
        bullets: [
          {
            id: 'Gunakan command yang dideklarasikan repository dan jalankan subset terkecil yang mencakup perubahan sebelum suite lebih luas.',
            en: 'Use repository-declared commands and run the smallest relevant subset before a broader suite.',
          },
          {
            id: 'Jangan menyatakan build atau test lulus jika command tidak dijalankan atau keluar dengan status gagal.',
            en: 'Do not claim a build or test passed if it was not run or returned a failure status.',
          },
          {
            id: 'Jika environment menghalangi tes, tulis command yang dicoba dan hambatan spesifiknya.',
            en: 'If the environment blocks a test, report the attempted command and the specific blocker.',
          },
        ],
      },
    ],
  },
  'ui-size': {
    sections: [
      {
        title: { id: 'Batas lunak, bukan target', en: 'A soft limit, not a target' },
        bullets: [
          {
            id: 'Tinjau komponen UI yang melampaui sekitar 250 baris untuk menemukan tanggung jawab yang benar-benar terpisah.',
            en: 'Review UI components above roughly 250 lines for genuinely separate responsibilities.',
          },
          {
            id: 'Jangan ekstrak komponen hanya untuk menurunkan hitungan baris jika alur data dan perilaku tetap sulit dipahami.',
            en: 'Do not extract components merely to reduce line count if data flow and behavior remain hard to understand.',
          },
          {
            id: 'Pertahankan colocated bagian yang hanya dimiliki satu fitur; pindahkan ke shared layer saat ada pemakai nyata lintas fitur.',
            en: 'Keep single-feature parts colocated; move them to a shared layer only when multiple features actually use them.',
          },
        ],
      },
      {
        title: { id: 'Ekstraksi yang sehat', en: 'Healthy extraction' },
        bullets: [
          {
            id: 'Pisahkan UI dari state/mutation ketika logika tersebut bisa diuji atau digunakan secara independen.',
            en: 'Separate UI from state/mutations when that logic can be tested or reused independently.',
          },
          {
            id: 'Jaga props dan return values tetap eksplisit; hindari komponen wrapper yang hanya meneruskan semua props.',
            en: 'Keep props and return values explicit; avoid wrapper components that only forward every prop.',
          },
          {
            id: 'Selesaikan satu ekstraksi dalam task aktif dan pastikan tes perilaku tetap melindungi interaksi.',
            en: 'Keep extraction scoped to the active task and ensure behavior tests still protect the interaction.',
          },
        ],
      },
    ],
  },
  'zero-any': {
    sections: [
      {
        title: { id: 'TypeScript: data tidak tepercaya', en: 'TypeScript: untrusted data' },
        bullets: [
          {
            id: 'Gunakan `unknown` untuk JSON, response network, dan input dinamis; validasi lalu sempitkan tipe sebelum akses field.',
            en: 'Use `unknown` for JSON, network responses, and dynamic input; validate and narrow before accessing fields.',
          },
          {
            id: 'Hindari `any`, `as any`, `@ts-ignore`, dan nonaktifkan rule typecheck untuk melewati desain tipe.',
            en: 'Avoid `any`, `as any`, `@ts-ignore`, and disabling type checks to bypass type design.',
          },
          {
            id: 'Pilih union yang diskriminatif untuk state sukses/error dan exhaustiveness check pada cabang penting.',
            en: 'Use discriminated unions for success/error state and exhaustive checks for important branches.',
          },
          {
            id: 'Bila library memang bertipe longgar, batasi cast pada satu adapter kecil dan dokumentasikan invariant yang diverifikasi.',
            en: 'If a library is loosely typed, confine the cast to a small adapter and document the verified invariant.',
          },
        ],
      },
      {
        title: { id: 'Tipe yang selaras dengan runtime', en: 'Types aligned with runtime' },
        bullets: [
          {
            id: 'Tipe compile-time tidak memvalidasi payload pada runtime; gunakan parser atau schema yang sudah dipakai proyek.',
            en: 'Compile-time types do not validate runtime payloads; use the parser or schema already used by the project.',
          },
          {
            id: 'Hindari duplikasi tipe yang bisa diimpor dari sumber pemiliknya.',
            en: 'Avoid duplicating types that can be imported from their owning source.',
          },
          {
            id: 'Jangan memperkenalkan TypeScript hanya demi menerapkan skill ini pada proyek yang tidak menggunakannya.',
            en: 'Do not introduce TypeScript just to apply this skill to a project that does not use it.',
          },
        ],
      },
    ],
    example: {
      title: { id: 'Pola narrowing', en: 'Narrowing pattern' },
      language: 'ts',
      stacks: ['typescript'],
      code: `function readName(value: unknown): string | undefined {
  if (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    typeof value.name === 'string'
  ) {
    return value.name;
  }
  return undefined;
}`,
    },
  },
  routes: {
    sections: [
      {
        title: { id: 'Pemetaan route', en: 'Route mapping' },
        bullets: [
          {
            id: 'Cari definisi route, middleware, nama route, dan pemanggil sebelum mengubah URL atau method.',
            en: 'Find route definitions, middleware, route names, and callers before changing a URL or method.',
          },
          {
            id: 'Pertahankan route name/constant yang sudah menjadi sumber link dan redirect; jangan membuat string path duplikat.',
            en: 'Preserve route names/constants already used for links and redirects; do not add duplicate path strings.',
          },
          {
            id: 'Tempatkan endpoint baru mengikuti pengelompokan dan middleware route yang berdekatan.',
            en: 'Place new endpoints alongside the existing route grouping and middleware.',
          },
          {
            id: 'Pisahkan autentikasi, authorization resource, dan validasi input; ketiganya melindungi boundary yang berbeda.',
            en: 'Separate authentication, resource authorization, and input validation; they protect different boundaries.',
          },
        ],
      },
      {
        title: { id: 'URL dan integrasi', en: 'URLs and integrations' },
        bullets: [
          {
            id: 'Gunakan URL generator atau helper yang telah dipakai proyek untuk link internal.',
            en: 'Use the URL generator or helper already used by the project for internal links.',
          },
          {
            id: 'Untuk route API, pertahankan versi, format respons, status code, dan validasi agar client tetap kompatibel.',
            en: 'For API routes, preserve versioning, response shape, status codes, and validation so clients remain compatible.',
          },
          {
            id: 'Perubahan route publik memerlukan tes akses dan dokumentasi kontrak yang sesuai.',
            en: 'Public route changes require access tests and the corresponding contract documentation.',
          },
        ],
      },
    ],
    example: {
      title: { id: 'Laravel: route bernama', en: 'Laravel: named route' },
      language: 'php',
      stacks: ['laravel'],
      code: `Route::get('/orders/{order}', [OrderController::class, 'show'])
    ->name('orders.show');

route('orders.show', $order);`,
    },
  },
  forms: {
    sections: [
      {
        title: { id: 'Kontrak field dan validasi', en: 'Field contracts and validation' },
        bullets: [
          {
            id: 'Label menjelaskan data yang diminta; tandai field wajib dan opsional dengan istilah yang konsisten.',
            en: 'Labels explain the requested data; mark required and optional fields consistently.',
          },
          {
            id: 'Placeholder memberi contoh format, bukan menggantikan label atau instruksi aksesibel.',
            en: 'Placeholders show an example format; they do not replace labels or accessible instructions.',
          },
          {
            id: 'Validasi server tetap otoritatif. Samakan batas, format, dan pesan dengan validasi client bila keduanya ada.',
            en: 'Server validation remains authoritative. Align constraints, formats, and messages with client validation when both exist.',
          },
          {
            id: 'Tampilkan error dekat field dan pertahankan input yang valid setelah kegagalan submit bila pola aplikasi mendukungnya.',
            en: 'Show errors near fields and preserve valid input after a failed submit when the application pattern supports it.',
          },
        ],
      },
      {
        title: { id: 'Kondisi interaksi', en: 'Interaction states' },
        bullets: [
          {
            id: 'Cegah submit ganda ketika request berlangsung dan tampilkan status loading yang dapat dipahami.',
            en: 'Prevent duplicate submission while a request is running and show a clear loading state.',
          },
          {
            id: 'Berikan hasil sukses atau gagal yang nyata; jangan menghapus nilai atau menutup dialog sebelum operasi berhasil.',
            en: 'Provide real success or failure feedback; do not clear values or close a dialog before the operation succeeds.',
          },
          {
            id: 'Aksi destruktif meminta konfirmasi kustom yang menyebutkan konsekuensi dan objek terdampak.',
            en: 'Destructive actions use a custom confirmation that names the consequence and affected object.',
          },
        ],
      },
    ],
    example: {
      title: { id: 'Blade: error field dan CSRF', en: 'Blade: field error and CSRF' },
      language: 'php',
      stacks: ['laravel'],
      code: `<form method="POST" action="{{ route('profile.update') }}">
    @csrf
    <label for="name">Nama</label>
    <input id="name" name="name" value="{{ old('name') }}">
    @error('name') <p role="alert">{{ $message }}</p> @enderror
</form>`,
    },
  },
  'ui-tests': {
    sections: [
      {
        title: { id: 'Tes berdasarkan perilaku', en: 'Test behavior' },
        bullets: [
          {
            id: 'Uji interaksi yang dilihat pengguna: input, submit, navigasi, feedback, dan state data.',
            en: 'Test user-visible interactions: input, submission, navigation, feedback, and data states.',
          },
          {
            id: 'Gunakan query berbasis role/label saat tersedia; hindari selector yang bergantung pada struktur DOM internal.',
            en: 'Use role/label-based queries when available; avoid selectors coupled to internal DOM structure.',
          },
          {
            id: 'Stub boundary network atau browser yang tidak deterministik; jangan mock fungsi murni yang mudah dijalankan.',
            en: 'Stub nondeterministic network or browser boundaries; do not mock pure functions that are easy to run.',
          },
          {
            id: 'Tes submit gagal dan sukses secara terpisah, termasuk pesan dan nilai form setelah hasilnya.',
            en: 'Test failed and successful submissions separately, including messages and resulting form values.',
          },
        ],
      },
      {
        title: { id: 'Kondisi UI', en: 'UI states' },
        bullets: [
          {
            id: 'Untuk daftar data, cover loading, kosong, error, dan pagination/data besar jika kondisi tersebut ada.',
            en: 'For data lists, cover loading, empty, error, and pagination/large data when those states exist.',
          },
          {
            id: 'Untuk keyboard, verifikasi urutan fokus, aktivasi kontrol, dan indikator fokus yang terlihat.',
            en: 'For keyboard use, verify focus order, control activation, and visible focus indicators.',
          },
          {
            id: 'Ikuti lokasi serta runner tes yang sudah digunakan project; jangan membuat runner kedua tanpa kebutuhan.',
            en: 'Follow the project’s existing test location and runner; do not add a second runner without need.',
          },
        ],
      },
    ],
  },
  accessibility: {
    sections: [
      {
        title: { id: 'Semantik dan nama aksesibel', en: 'Semantics and accessible names' },
        bullets: [
          {
            id: 'Gunakan elemen HTML semantik dan kontrol native sebelum membuat widget custom.',
            en: 'Use semantic HTML and native controls before creating custom widgets.',
          },
          {
            id: 'Setiap input memiliki label yang terhubung; tombol dan link menyebutkan tujuan dengan jelas.',
            en: 'Every input has an associated label; buttons and links clearly state their purpose.',
          },
          {
            id: 'Pesan error, status sukses, dan perubahan dinamis diumumkan melalui pola aksesibel yang sesuai.',
            en: 'Error messages, success status, and dynamic changes are announced with appropriate accessible patterns.',
          },
          {
            id: 'Gambar informatif memiliki teks alternatif; gambar dekoratif tidak menambah noise pembaca layar.',
            en: 'Informative images have alternative text; decorative images do not add screen-reader noise.',
          },
        ],
      },
      {
        title: { id: 'Keyboard, fokus, dan visual', en: 'Keyboard, focus, and visuals' },
        bullets: [
          {
            id: 'Semua fungsi dapat dijalankan dengan keyboard tanpa jebakan fokus.',
            en: 'All functionality is available by keyboard without focus traps.',
          },
          {
            id: 'Jangan menghapus outline tanpa pengganti yang terlihat dan kontras.',
            en: 'Do not remove outlines without a visible, high-contrast replacement.',
          },
          {
            id: 'Informasi tidak dibedakan hanya melalui warna; periksa kontras teks dan kontrol.',
            en: 'Do not convey information through color alone; check text and control contrast.',
          },
          {
            id: 'Hormati preferensi reduced motion dan hindari animasi yang mengganggu tugas.',
            en: 'Respect reduced-motion preferences and avoid animations that interfere with tasks.',
          },
        ],
      },
    ],
  },
  mascot: {
    sections: [
      {
        title: { id: 'Gunakan identitas maskot proyek', en: 'Use the project mascot identity' },
        bullets: [
          {
            id: 'Periksa `<output>/project/mascot.md`. Jika profil ada, gunakan identitas itu untuk pose dan variasi; baca profil dan lampirkan gambar guide sebagai input visual. Menyebut path dalam prompt saja tidak cukup.',
            en: 'Check `<output>/project/mascot.md`. If a profile exists, use that identity for poses and variations; read it and attach the guide image as visual input. Mentioning its path in a prompt is not enough.',
          },
          {
            id: 'Pertahankan siluet, wajah, palet, logo, dan aksesori khas. Ubah hanya pose atau properti yang diminta; tanyakan jika permintaan bertentangan dengan identitas yang tercatat.',
            en: 'Preserve the silhouette, face, palette, logo, and signature accessories. Change only the requested pose or prop; ask if the request conflicts with the recorded identity.',
          },
          {
            id: 'Mulai identitas baru atau redesign hanya jika developer memintanya. Untuk alur itu, baca [alur konsep maskot](mascot-concepts.md) sebelum membuat gambar.',
            en: 'Start a new identity or redesign only when the developer asks. For that workflow, read the [mascot concept workflow](mascot-concepts.md) before generating images.',
          },
          {
            id: 'Jangan mengklaim aset sudah dibuat atau guide aktif sebelum file benar-benar tersedia dan dapat diperiksa.',
            en: 'Do not claim an asset was created or a guide is active until the file exists and can be inspected.',
          },
        ],
      },
    ],
  },
  dependencies: {
    sections: [
      {
        title: { id: 'Sebelum menambah package', en: 'Before adding a package' },
        bullets: [
          {
            id: 'Cari utilitas atau kemampuan framework yang sudah tersedia sebelum memilih dependency baru.',
            en: 'Look for existing utilities or framework capabilities before choosing a new dependency.',
          },
          {
            id: 'Jelaskan kebutuhan, alternatif, ukuran dampak runtime, status pemeliharaan, license, dan kompatibilitas versi.',
            en: 'Explain the need, alternatives, runtime impact, maintenance status, license, and version compatibility.',
          },
          {
            id: 'Gunakan package manager dan lockfile yang dipakai repository; jangan edit lockfile secara manual.',
            en: 'Use the repository’s package manager and lockfile; do not edit lockfiles manually.',
          },
          {
            id: 'Jangan mengubah dependency langsung kecuali disetujui dalam scope task.',
            en: 'Do not change direct dependencies unless that change is approved in the task scope.',
          },
        ],
      },
      {
        title: { id: 'Versi dan supply chain', en: 'Versions and supply chain' },
        bullets: [
          {
            id: 'Periksa versi yang terkunci sebelum memakai API; nama package saja tidak membuktikan versinya.',
            en: 'Check the locked version before using an API; a package name alone does not prove its version.',
          },
          {
            id: 'Pilih versi yang kompatibel dengan runtime dan dependency peer tanpa menghapus lockfile.',
            en: 'Choose a version compatible with the runtime and peer dependencies without removing the lockfile.',
          },
          {
            id: 'Jangan menjalankan script install atau package tak dikenal selama analisis repository.',
            en: 'Do not run install scripts or unknown packages during repository analysis.',
          },
        ],
      },
    ],
  },
};

export function localized(value: Localized, language: Language): string {
  return value[language];
}

export const mascotConceptSections: GuideSection[] = [
  {
    title: {
      id: 'Pahami brief dan siapkan lokasi',
      en: 'Understand the brief and choose a location',
    },
    bullets: [
      {
        id: 'Periksa website, logo, palet, ilustrasi, dan tujuan produk. Jangan mengarang identitas brand; tanyakan hanya detail yang tidak bisa ditemukan dari repository.',
        en: 'Inspect the website, logo, palette, illustrations, and product purpose. Do not invent brand identity; ask only for details unavailable in the repository.',
      },
      {
        id: 'Simpan aset di folder gambar proyek yang sudah digunakan. Jika belum ada konvensi, gunakan `assets/mascot`; jika beberapa lokasi sama-sama cocok, tanyakan.',
        en: 'Use the project’s existing image asset folder. If no convention exists, use `assets/mascot`; ask if multiple locations fit equally well.',
      },
    ],
  },
  {
    title: { id: 'Buat dan bandingkan empat konsep', en: 'Create and compare four concepts' },
    bullets: [
      {
        id: 'Buat empat file PNG terpisah dengan siluet atau karakter berbeda, gaya ilustrasi konsisten, dan aksesori unik yang benar-benar terkait produk atau logo yang tersedia.',
        en: 'Create four separate PNGs with distinct silhouettes or characters, a consistent illustration style, and a signature accessory grounded in the product or available logo.',
      },
      {
        id: 'Gunakan folder baru `<mascot-root>/<run-id>/` dan subfolder per putaran (`round-01/01.png` hingga `04.png`). Catat deskripsi dan path yang benar di `selection.md` sebelum melaporkannya.',
        en: 'Use a new `<mascot-root>/<run-id>/` folder and one subfolder per round (`round-01/01.png` through `04.png`). Record accurate descriptions and paths in `selection.md` before reporting them.',
      },
      {
        id: 'Tampilkan empat kandidat beserta nomor, ringkasan, dan path. Tunggu pilihan atau permintaan putaran baru; kandidat dari putaran sebelumnya tetap dapat dipilih.',
        en: 'Show all four candidates with a number, summary, and path. Wait for a choice or another round; earlier candidates remain selectable.',
      },
    ],
  },
  {
    title: {
      id: 'Tetapkan pilihan dan buat guide',
      en: 'Finalize the choice and create the guide',
    },
    bullets: [
      {
        id: 'Pindahkan pilihan ke `selected.png`. Hapus hanya kandidat eksplorasi yang tidak dipilih; perbarui `selection.md` agar tidak menyisakan path aset yang sudah dihapus. Jangan menghapus aset lama atau aset yang dipakai di tempat lain.',
        en: 'Move the chosen image to `selected.png`. Delete only unselected candidates from this exploration and update `selection.md` so it has no paths to deleted files. Never remove older or otherwise-used assets.',
      },
      {
        id: 'Lampirkan `selected.png` ke tool generasi. Buat satu gambar 2×2 full-body ortografis berlatar polos: depan kiri atas, belakang kanan atas, sisi kanan maskot kiri bawah, sisi kiri maskot kanan bawah.',
        en: 'Attach `selected.png` to the image tool. Create one full-body orthographic 2×2 sheet on a plain background: front top-left, back top-right, mascot’s right side bottom-left, left side bottom-right.',
      },
      {
        id: 'Periksa keempat tampak: identitas, proporsi, palet, logo, dan aksesori harus konsisten serta setiap sisi terlihat jelas. Jika gagal, perbaiki atau buat ulang; jangan aktifkan guide yang belum valid.',
        en: 'Inspect all four views for consistent identity, proportions, palette, logo, and accessories, and confirm each side is clear. Repair or regenerate failures; do not activate an invalid guide.',
      },
      {
        id: 'Simpan sebagai `guide.png`. Jika lolos pemeriksaan, aktifkan otomatis tanpa meminta persetujuan tambahan.',
        en: 'Save as `guide.png`. Once it passes inspection, activate it automatically without another approval prompt.',
      },
    ],
  },
  {
    title: {
      id: 'Simpan identitas dan tangani keterbatasan tool',
      en: 'Record identity and handle tool limitations',
    },
    bullets: [
      {
        id: 'Buat atau perbarui `<output>/project/mascot.md` dengan ciri tetap, warna, aksesori, urutan panel, dan tautan gambar relatif yang valid ke `selected.png` serta `guide.png`. Tambahkan tautan dari panduan kanonis di luar managed block setelah file ada.',
        en: 'Create or update `<output>/project/mascot.md` with fixed traits, colors, accessories, panel order, and valid relative image links to `selected.png` and `guide.png`. Link it from the canonical guide outside its managed block only after the file exists.',
      },
      {
        id: 'Untuk variasi berikutnya, baca profil dan lampirkan `guide.png` sebagai input gambar. Ubah hanya pose atau properti yang diminta.',
        en: 'For later variations, read the profile and attach `guide.png` as an image input. Change only the requested pose or prop.',
      },
      {
        id: 'Pastikan tool yang tersedia mendukung generasi gambar dan lampiran referensi; jangan menebak berdasarkan nama agent. Jika tidak, simpan brief dan prompt di `<mascot-root>/<run-id>/prompts.md`, termasuk semua path gambar yang harus dilampirkan sebagai input. Beri tahu developer dan tunggu file sebelum melanjutkan.',
        en: 'Confirm the available tools support image generation and reference attachments; do not infer capability from the agent name. Otherwise save the brief and prompts in `<mascot-root>/<run-id>/prompts.md`, including every image path that must be attached as input. Tell the developer and wait for files before resuming.',
      },
    ],
  },
];

const laravelGuidance: Partial<Record<Skill, Localized[]>> = {
  quality: [
    {
      id: 'Untuk PHP/Laravel, ikuti struktur `app/`, `routes/`, `database/`, dan pola sibling yang sudah ada. Gunakan fasilitas Laravel sebelum membuat kerangka abstraksi baru.',
      en: 'For PHP/Laravel, follow the existing `app/`, `routes/`, and `database/` structure and sibling patterns. Prefer Laravel facilities over new abstraction frameworks.',
    },
  ],
  docs: [
    {
      id: 'Perubahan Laravel yang menyentuh route, migration, config, queue, atau command harus memperbarui panduan pemiliknya jika perubahan itu mengubah setup atau operasi.',
      en: 'Laravel changes to routes, migrations, config, queues, or commands should update their owning guide when setup or operations change.',
    },
  ],
  contracts: [
    {
      id: 'Ikuti pola repository untuk Form Request, Policy/Gate, Resource, dan transaksi. Jangan berasumsi setiap proyek memerlukan semuanya atau menambah lapisan baru tanpa kebutuhan.',
      en: 'Follow repository patterns for Form Requests, Policies/Gates, Resources, and transactions. Do not assume every project needs each layer or add one without need.',
    },
  ],
  testing: [
    {
      id: 'Untuk tes Laravel, gunakan runner dan factory yang sudah ada. Tes feature cocok untuk kontrak HTTP dan authorization; tes unit untuk aturan murni yang terisolasi.',
      en: 'For Laravel tests, use the existing runner and factories. Feature tests suit HTTP contracts and authorization; unit tests suit isolated pure rules.',
    },
  ],
  routes: [
    {
      id: 'Tempatkan route pada file dan group yang sudah ada di `routes/`; pertahankan middleware dan route name. Jangan membuat registry URL kedua jika belum menjadi pola proyek.',
      en: 'Place routes in the existing files and groups under `routes/`; preserve middleware and route names. Do not invent a second URL registry if the project has none.',
    },
  ],
  forms: [
    {
      id: 'Pada form Laravel, pertahankan CSRF, validasi server, input lama, dan pesan error per field sesuai pola Blade/Inertia yang ditemukan.',
      en: 'For Laravel forms, preserve CSRF, server validation, old input, and field-level errors according to the discovered Blade/Inertia pattern.',
    },
  ],
  'ui-tests': [
    {
      id: 'Jika UI memakai Blade, utamakan tes feature/render yang sudah dipakai proyek. Jangan mewajibkan runner komponen React ketika React tidak terdeteksi.',
      en: 'If the UI uses Blade, prefer the project’s existing feature/render tests. Do not require a React component runner when React was not detected.',
    },
  ],
  dependencies: [
    {
      id: 'Perubahan package PHP harus menjaga `composer.json` dan `composer.lock` konsisten; perubahan frontend menjaga manifest dan lockfile package manager yang digunakan.',
      en: 'PHP package changes keep `composer.json` and `composer.lock` consistent; frontend changes keep the selected package manifest and lockfile consistent.',
    },
  ],
};

const reactGuidance: Partial<Record<Skill, Localized[]>> = {
  quality: [
    {
      id: 'Untuk UI React, pisahkan state/mutation yang kompleks dari komponen presentasi hanya ketika batas tersebut membuat perilaku lebih mudah dipahami atau diuji.',
      en: 'For React UI, separate complex state/mutations from presentation only when the boundary makes behavior easier to understand or test.',
    },
  ],
  forms: [
    {
      id: 'Gunakan state submit yang eksplisit dan cegah submit berulang; tampilkan error field dari sumber validasi yang otoritatif.',
      en: 'Use explicit submission state and prevent duplicate submissions; show field errors from the authoritative validation source.',
    },
  ],
  'ui-tests': [
    {
      id: 'Uji komponen React lewat role, label, dan interaksi pengguna. Colocate tes hanya jika itu sudah menjadi pola repository.',
      en: 'Test React components through roles, labels, and user interactions. Colocate tests only when that is an established repository pattern.',
    },
  ],
};

const goGuidance: Partial<Record<Skill, Localized[]>> = {
  quality: [
    {
      id: 'Untuk Go, ikuti package boundary dan pola error yang digunakan modul tetangga. Hindari package `util` generik dan interface yang dibuat sebelum ada kebutuhan substitusi.',
      en: 'For Go, follow neighboring package boundaries and error patterns. Avoid generic `util` packages and interfaces created before substitution is needed.',
    },
  ],
  contracts: [
    {
      id: 'Pertahankan context cancellation, batas ukuran request, status HTTP, dan bentuk error saat mengubah handler atau middleware.',
      en: 'Preserve context cancellation, request-size limits, HTTP status, and error shape when changing handlers or middleware.',
    },
  ],
  testing: [
    {
      id: 'Utamakan table-driven test untuk variasi input dan gunakan `httptest` untuk kontrak handler HTTP ketika sesuai pola proyek.',
      en: 'Prefer table-driven tests for input variants and use `httptest` for HTTP handler contracts when consistent with the project.',
    },
  ],
};

const ginGuidance: Partial<Record<Skill, Localized[]>> = {
  routes: [
    {
      id: 'Untuk Gin, daftarkan route pada group/router yang sudah mengatur prefix dan middleware; jangan memasang middleware auth hanya pada UI client.',
      en: 'For Gin, register routes in the existing group/router that owns prefixes and middleware; do not enforce authentication only in the client UI.',
    },
  ],
};

export function contextualGuideSections(
  skill: Skill,
  stack: readonly string[],
  sourceEvidence: readonly string[],
  nextRouter: 'app' | 'pages' | 'mixed' | 'unknown' = 'unknown',
): GuideSection[] {
  const selected = new Set(resolveStack(stack).values);
  const notes: Localized[] = [];
  if (selected.has('laravel')) notes.push(...(laravelGuidance[skill] ?? []));
  if (selected.has('react') || selected.has('inertia')) notes.push(...(reactGuidance[skill] ?? []));
  if (selected.has('nextjs') && skill === 'quality') {
    const nextNotes: Record<typeof nextRouter, Localized> = {
      app: {
        id: 'Project memakai Next.js App Router. Pertahankan Server Component sebagai default dan letakkan `use client` dekat interaksi browser.',
        en: 'This project uses the Next.js App Router. Keep Server Components as the default and place `use client` close to browser interaction.',
      },
      pages: {
        id: 'Project memakai Next.js Pages Router. Ikuti pola `pages/` yang ada; jangan menerapkan asumsi Server Component dari App Router.',
        en: 'This project uses the Next.js Pages Router. Follow its existing `pages/` patterns; do not apply App Router Server Component assumptions.',
      },
      mixed: {
        id: 'Project memiliki App Router dan Pages Router. Ikuti boundary router pada file yang diubah dan jangan memindahkan pola antar-router tanpa alasan.',
        en: 'This project contains both App Router and Pages Router. Follow the changed file’s router boundary; do not transfer patterns between them without a reason.',
      },
      unknown: {
        id: 'Next.js terdeteksi, tetapi router belum dapat dipastikan dari file entry. Periksa struktur route sebelum memilih pola App Router atau Pages Router.',
        en: 'Next.js is detected, but no router entry file was identified. Inspect the route structure before choosing App Router or Pages Router patterns.',
      },
    };
    notes.push(nextNotes[nextRouter]);
  }
  if (selected.has('nextjs') && skill === 'routes') {
    const routerNote: Record<typeof nextRouter, Localized> = {
      app: {
        id: 'Pertahankan struktur App Router dan file privat sesuai pola route yang ada.',
        en: 'Preserve the App Router structure and private files used by existing routes.',
      },
      pages: {
        id: 'Pertahankan struktur Pages Router, termasuk `_app` dan `_document`, sesuai pola yang ada.',
        en: 'Preserve the Pages Router structure, including `_app` and `_document`, used by existing routes.',
      },
      mixed: {
        id: 'Periksa apakah route berada di App Router atau Pages Router sebelum mengubah file dan helper.',
        en: 'Check whether a route belongs to App Router or Pages Router before changing files and helpers.',
      },
      unknown: {
        id: 'Periksa router dari file route yang ada sebelum menerapkan pola App Router atau Pages Router.',
        en: 'Inspect existing route files before applying App Router or Pages Router patterns.',
      },
    };
    notes.push(routerNote[nextRouter]);
  }
  if (selected.has('go')) notes.push(...(goGuidance[skill] ?? []));
  if (selected.has('gin')) notes.push(...(ginGuidance[skill] ?? []));
  if (
    skill === 'zero-any' &&
    !sourceEvidence.some((extension) => ['.ts', '.tsx', '.mts', '.cts'].includes(extension))
  ) {
    notes.push({
      id: 'Pemindaian source saat ini tidak menemukan berkas TypeScript; terapkan aturan ini hanya pada berkas TypeScript yang benar-benar ditambahkan atau diubah.',
      en: 'The current source scan found no TypeScript files; apply this guidance only to TypeScript files actually added or changed.',
    });
  }
  if (!notes.length) return [];
  return [
    {
      title: {
        id: 'Penerapan pada stack yang terdeteksi',
        en: 'Apply to the detected stack',
      },
      bullets: notes,
    },
  ];
}
