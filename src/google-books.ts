import got from "got/dist/source";

export interface Book {
  kind: "books#volume";
  id: string;
  volumeInfo: {
    title: string;
    authors: string[];
    publisher: string;
    publishedDate: string;
    description: string;
    industryIdentifiers: [
      {
        type: "ISBN_13";
        identifier: string;
      },
      {
        type: "ISBN_10";
        identifier: string;
      }
    ];
    pageCount: number;
    printType: "BOOK";
    categories: string[];
    averageRating: number;
    ratingsCount: number;
    maturityRating: "MATURE" | "NOT_MATURE";
    imageLinks: {
      thumbnail: string;
    };
    language: string;
    previewLink: string;
    infoLink: string;
    canonicalVolumeLink: string;
  };
}

export interface BookResult {
  title: string;
  authors: string[];
  publisher: string;
  publishedDate: string;
  description: string;
  image: string;
  language: string;
  averageRating: number;
  ratingsCount: number;
  categories: string[];
  pageCount: number;
  isbn10?: string;
  isbn13?: string;
  googleBooks: {
    id: string;
    preview: string;
    info: string;
    canonical: string;
  };
}

const LANG_MAP: Record<string, string> = {
  eng: "en", fre: "fr", fra: "fr", deu: "de", ger: "de",
  spa: "es", ita: "it", por: "pt", rus: "ru", jpn: "ja",
  zho: "zh", chi: "zh", kor: "ko", hin: "hi", ara: "ar",
  nld: "nl", dut: "nl", swe: "sv", pol: "pl", tur: "tr",
  dan: "da", nor: "no", fin: "fi", hun: "hu", cze: "cs",
  gre: "el", heb: "he", tha: "th", vie: "vi", ind: "id",
  may: "ms", per: "fa", urd: "ur", ben: "bn", tam: "ta",
  tel: "te", mar: "mr", guj: "gu", kan: "kn", mal: "ml",
};
const mapLanguageCode = (code: string): string => LANG_MAP[code] || code;

export const selectBestBook = (items: Book[]): Book => {
  if (!items.length) throw new Error("Book not found");
  return items[0];
};

const rateLimitRetryDelaysMs = [1000, 3000, 5000];

const isRateLimitError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as { response?: { statusCode?: number } }).response?.statusCode === 429;

const wait = async (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Extract Open Library edition ID (OL*M) from text.
 * Matches: "OL57519135M", "https://openlibrary.org/books/OL57519135M", or full URLs with params.
 */
const extractOLEditionId = (text: string): string | null => {
  const match = text.match(/\b(OL\d+M)\b/);
  return match ? match[1] : null;
};

/**
 * Fetch book directly by Open Library edition ID (e.g. OL57519135M)
 */
const fetchByEditionId = async (editionId: string): Promise<BookResult> => {
  console.log(`bookshelf-action: fetching Open Library edition ${editionId}`);

  const editionRes = await got<any>(
    `https://openlibrary.org/books/${editionId}.json`,
    { responseType: "json" }
  );
  const ed = editionRes.body;

  // Resolve author names from author keys
  const authors: string[] = [];
  if (ed.authors && ed.authors.length > 0) {
    for (const authorRef of ed.authors) {
      const authorKey = authorRef.key || authorRef;
      try {
        const authorRes = await got<any>(
          `https://openlibrary.org${authorKey}.json`,
          { responseType: "json" }
        );
        authors.push(authorRes.body.name || authorRes.body.personal_name || "");
      } catch (e) {
        // Skip unresolvable author
      }
    }
  }

  // Get work-level data (subjects, description)
  let description = "";
  let categories: string[] = [];
  if (ed.works && ed.works.length > 0) {
    try {
      const workRes = await got<any>(
        `https://openlibrary.org${ed.works[0].key}.json`,
        { responseType: "json" }
      );
      const work = workRes.body;
      description = work.description?.value || work.description || "";
      categories = (work.subjects || []).slice(0, 5);
    } catch (e) {
      // Work lookup failed
    }
  }

  // Cover image
  let image = "";
  if (ed.covers && ed.covers.length > 0 && ed.covers[0] > 0) {
    image = `https://covers.openlibrary.org/b/id/${ed.covers[0]}-L.jpg`;
  } else {
    image = `https://covers.openlibrary.org/b/olid/${editionId}-L.jpg`;
  }

  // ISBN
  let isbn13: string | undefined;
  let isbn10: string | undefined;
  if (ed.isbn_13?.length) isbn13 = ed.isbn_13[0];
  if (ed.isbn_10?.length) isbn10 = ed.isbn_10[0];

  // Language
  let language = "en";
  if (ed.languages?.length) {
    const langKey = ed.languages[0].key || "";
    const langCode = langKey.replace("/languages/", "");
    language = mapLanguageCode(langCode);
  }

  // Publisher
  const publisher = ed.publishers?.length ? ed.publishers[0] : "";

  // Publish date → year
  const publishedDate = ed.publish_date || "";

  console.log(`bookshelf-action: found "${ed.title}" by ${authors.join(", ")} (${editionId})`);

  return {
    title: ed.title,
    authors,
    publisher,
    publishedDate,
    description: typeof description === "string" ? description.substring(0, 500) : "",
    image,
    language,
    averageRating: 0,
    ratingsCount: 0,
    categories,
    pageCount: ed.number_of_pages || 0,
    isbn10,
    isbn13,
    googleBooks: {
      id: editionId,
      preview: `https://openlibrary.org/books/${editionId}`,
      info: `https://openlibrary.org/books/${editionId}`,
      canonical: `https://openlibrary.org/books/${editionId}`,
    },
  };
};

/**
 * Search Open Library API by title/author (free, no key required)
 */
const searchOpenLibrary = async (q: string): Promise<BookResult> => {
  console.log(`bookshelf-action: searching Open Library for "${q}"`);

  // Parse "Title by Author" format
  let title = q;
  let author = "";
  const byMatch = q.match(/^(.+?)\s+by\s+(.+)$/i);
  if (byMatch) {
    title = byMatch[1].trim();
    author = byMatch[2].trim();
  }

  // Search Open Library
  let searchUrl = `https://openlibrary.org/search.json?title=${encodeURIComponent(title)}&limit=3`;
  if (author) searchUrl += `&author=${encodeURIComponent(author)}`;

  const searchRes = await got<any>(searchUrl, { responseType: "json" });
  const docs = searchRes.body.docs;

  if (!docs || docs.length === 0) {
    throw new Error("Book not found on Open Library");
  }

  const doc = docs[0];
  console.log(`bookshelf-action: Open Library found "${doc.title}" by ${doc.author_name?.join(", ")}`);

  // Get cover image
  let image = "";
  if (doc.cover_i) {
    image = `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`;
  } else if (doc.cover_edition_key) {
    image = `https://covers.openlibrary.org/b/olid/${doc.cover_edition_key}-L.jpg`;
  }

  // Try to get ISBN
  let isbn10: string | undefined;
  let isbn13: string | undefined;

  if (doc.isbn && doc.isbn.length > 0) {
    for (const isbn of doc.isbn) {
      if (isbn.length === 13 && !isbn13) isbn13 = isbn;
      if (isbn.length === 10 && !isbn10) isbn10 = isbn;
    }
  }

  // If no ISBN from search, try the edition endpoint
  if (!isbn13 && !isbn10 && doc.cover_edition_key) {
    try {
      const editionRes = await got<any>(
        `https://openlibrary.org/books/${doc.cover_edition_key}.json`,
        { responseType: "json" }
      );
      const ed = editionRes.body;
      if (ed.isbn_13?.length) isbn13 = ed.isbn_13[0];
      if (ed.isbn_10?.length) isbn10 = ed.isbn_10[0];
    } catch (e) {}
  }

  // Publisher
  let publisher = "";
  if (doc.publisher && doc.publisher.length > 0) {
    publisher = doc.publisher[0];
  }

  // Language
  let language = "en";
  if (doc.language && doc.language.length > 0) {
    language = mapLanguageCode(doc.language[0]);
  }

  // Fallback image
  if (!image) {
    const searchTitle = doc.title + (doc.author_name ? ` by ${doc.author_name.join(", ")}` : "");
    image = `https://tse2.mm.bing.net/th?q=${encodeURIComponent(searchTitle)}&w=256&c=7&rs=1&p=0&dpr=3&pid=1.7&mkt=en-IN&adlt=moderate`;
  }

  return {
    title: doc.title,
    authors: doc.author_name || [],
    publisher,
    publishedDate: doc.first_publish_year ? `${doc.first_publish_year}` : "",
    description: doc.first_sentence?.join(" ") || "",
    image,
    language,
    averageRating: doc.ratings_average || 0,
    ratingsCount: doc.ratings_count || 0,
    categories: doc.subject?.slice(0, 5) || [],
    pageCount: doc.number_of_pages_median || 0,
    isbn10,
    isbn13,
    googleBooks: {
      id: doc.key || "",
      preview: `https://openlibrary.org${doc.key}`,
      info: `https://openlibrary.org${doc.key}`,
      canonical: `https://openlibrary.org${doc.key}`,
    },
  };
};

/**
 * Search Google Books API (may fail with 429 if no API key)
 */
const searchGoogleBooks = async (q: string): Promise<BookResult> => {
  console.log(`bookshelf-action: trying Google Books for "${q}"`);

  let results: { body: { items?: Book[] } } | undefined;
  const url = `https://www.googleapis.com/books/v1/volumes?q=intitle:${encodeURIComponent(q)}`;

  for (let attempt = 0; !results; attempt += 1) {
    try {
      results = await got<{ items: Book[] }>(url, { responseType: "json" });
    } catch (error) {
      if (!isRateLimitError(error) || attempt >= rateLimitRetryDelaysMs.length) throw error;
      await wait(rateLimitRetryDelaysMs[attempt]);
    }
  }

  if (!results.body.items || results.body.items.length === 0) {
    throw new Error("Book not found on Google Books");
  }
  const result = selectBestBook(results.body.items);

  console.log(`bookshelf-action: Google Books found "${result.volumeInfo.title}"`);

  return {
    title: result.volumeInfo.title,
    authors: result.volumeInfo.authors,
    publisher: result.volumeInfo.publisher,
    publishedDate: result.volumeInfo.publishedDate,
    description: result.volumeInfo.description,
    image:
      (result.volumeInfo.imageLinks || {}).thumbnail ||
      `https://tse2.mm.bing.net/th?q=${encodeURIComponent(
        `${result.volumeInfo.title} by ${result.volumeInfo.authors.join(", ")}`
      )}&w=256&c=7&rs=1&p=0&dpr=3&pid=1.7&mkt=en-IN&adlt=moderate`,
    language: result.volumeInfo.language,
    averageRating: result.volumeInfo.averageRating,
    ratingsCount: result.volumeInfo.ratingsCount,
    categories: result.volumeInfo.categories,
    pageCount: result.volumeInfo.pageCount,
    isbn10: ((result.volumeInfo.industryIdentifiers || []).find((i) => i.type === "ISBN_10") || {})
      .identifier,
    isbn13: ((result.volumeInfo.industryIdentifiers || []).find((i) => i.type === "ISBN_13") || {})
      .identifier,
    googleBooks: {
      id: result.id,
      preview: result.volumeInfo.previewLink,
      info: result.volumeInfo.infoLink,
      canonical: result.volumeInfo.canonicalVolumeLink,
    },
  };
};

const NAMED_LANGUAGES: Record<string, string> = {
  english: "en", hindi: "hi", gujarati: "gu", marathi: "mr", bengali: "bn",
  tamil: "ta", telugu: "te", kannada: "kn", malayalam: "ml", urdu: "ur",
  french: "fr", german: "de", spanish: "es", italian: "it", portuguese: "pt",
  russian: "ru", japanese: "ja", chinese: "zh", korean: "ko", dutch: "nl",
};

const normalizeLanguage = (value: string): string => {
  const key = value.trim().toLowerCase();
  return NAMED_LANGUAGES[key] || mapLanguageCode(key);
};

/** Strip the trailing progress marker, e.g. "Title by Author (42%)" -> "Title by Author". */
export const stripProgress = (title: string): string => title.replace(/\s*\(\d+%\)\s*$/, "").trim();

const splitList = (value: string): string[] =>
  value.split(",").map((part) => part.trim()).filter(Boolean);

/**
 * Manual metadata written directly in the issue body, for books that neither
 * Google Books nor Open Library knows about. Lines are "key: value", optionally
 * wrapped in a fenced block. Unknown keys are ignored.
 */
export const parseManualMetadata = (body: string): Partial<BookResult> => {
  const manual: Partial<BookResult> = {};
  if (!body) return manual;

  const lines = body.replace(/```[a-z]*\n?/gi, "").split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*[-*]?\s*([a-z0-9_ ]+?)\s*:\s*(.+?)\s*$/i);
    if (!match) continue;
    const key = match[1].trim().toLowerCase().replace(/\s+/g, "");
    const value = match[2].trim();
    if (!value) continue;

    switch (key) {
      case "title": manual.title = value; break;
      case "author":
      case "authors": manual.authors = splitList(value); break;
      case "publisher": manual.publisher = value; break;
      case "year":
      case "published":
      case "publisheddate": manual.publishedDate = value; break;
      case "image":
      case "cover": manual.image = value; break;
      case "isbn13": manual.isbn13 = value.replace(/-/g, ""); break;
      case "isbn10": manual.isbn10 = value.replace(/-/g, ""); break;
      case "isbn": {
        const isbn = value.replace(/-/g, "");
        if (isbn.length === 10) manual.isbn10 = isbn;
        else manual.isbn13 = isbn;
        break;
      }
      case "pages":
      case "pagecount": {
        const pages = parseInt(value, 10);
        if (!isNaN(pages)) manual.pageCount = pages;
        break;
      }
      case "categories":
      case "subjects": manual.categories = splitList(value); break;
      case "language": manual.language = normalizeLanguage(value); break;
      case "rating":
      case "averagerating": {
        const rating = parseFloat(value);
        if (!isNaN(rating)) manual.averageRating = rating;
        break;
      }
      case "description": manual.description = value; break;
      case "link":
      case "url":
      case "source":
        manual.googleBooks = { id: "", preview: value, info: value, canonical: value };
        break;
      default: break;
    }
  }

  return manual;
};

const hasManualData = (manual: Partial<BookResult>): boolean => Object.keys(manual).length > 0;

/** Manual values win over looked-up ones, since they were written on purpose. */
const mergeManual = (result: BookResult, manual: Partial<BookResult>): BookResult => ({
  ...result,
  ...manual,
  googleBooks: manual.googleBooks?.info ? manual.googleBooks : result.googleBooks,
});

/** Build a complete record from manual metadata plus the issue title. */
const bookFromManual = (title: string, manual: Partial<BookResult>): BookResult => {
  const cleanTitle = stripProgress(title);
  const byMatch = cleanTitle.match(/^(.+?)\s+by\s+(.+)$/i);
  const fallbackTitle = byMatch ? byMatch[1].trim() : cleanTitle;
  const fallbackAuthors = byMatch ? splitList(byMatch[2]) : [];
  const resolvedTitle = manual.title || fallbackTitle;
  const resolvedAuthors = manual.authors || fallbackAuthors;

  console.log(`bookshelf-action: using metadata from the issue body for "${resolvedTitle}"`);

  return {
    title: resolvedTitle,
    authors: resolvedAuthors,
    publisher: manual.publisher || "",
    publishedDate: manual.publishedDate || "",
    description: manual.description || "",
    image:
      manual.image ||
      `https://tse2.mm.bing.net/th?q=${encodeURIComponent(
        `${resolvedTitle}${resolvedAuthors.length ? ` by ${resolvedAuthors.join(", ")}` : ""}`
      )}&w=256&c=7&rs=1&p=0&dpr=3&pid=1.7&mkt=en-IN&adlt=moderate`,
    language: manual.language || "en",
    averageRating: manual.averageRating || 0,
    ratingsCount: manual.ratingsCount || 0,
    categories: manual.categories || [],
    pageCount: manual.pageCount || 0,
    isbn10: manual.isbn10,
    isbn13: manual.isbn13,
    googleBooks: manual.googleBooks || { id: "", preview: "", info: "", canonical: "" },
  };
};

/**
 * Main search function — resolution priority:
 * 1. Issue body has OL edition ID (e.g. OL57519135M) → direct fetch
 * 2. Issue body has openlibrary.org URL → extract ID, direct fetch
 * 3. Google Books, then Open Library title search
 * 4. Neither knows the book → build the record from "key: value" lines in the body
 *
 * Metadata written in the issue body always overrides what a lookup returned.
 *
 * @param title - Issue title (e.g. "Norwegian Wood by Haruki Murakami")
 * @param body - Issue body (may contain an OL ID, a URL, or manual metadata)
 */
export const search = async (title: string, body?: string): Promise<BookResult> => {
  const manual = parseManualMetadata(body || "");
  const query = stripProgress(title);

  // Priority 1 & 2: Check issue body for Open Library edition ID or URL
  if (body) {
    const editionId = extractOLEditionId(body);
    if (editionId) {
      try {
        return mergeManual(await fetchByEditionId(editionId), manual);
      } catch (error) {
        console.log(`bookshelf-action: edition fetch failed (${error}), falling back to search...`);
      }
    }
  }

  // Priority 3: Try Google Books first, then Open Library search
  try {
    return mergeManual(await searchGoogleBooks(query), manual);
  } catch (error) {
    console.log(`bookshelf-action: Google Books failed (${error}), trying Open Library search...`);
  }

  try {
    return mergeManual(await searchOpenLibrary(query), manual);
  } catch (error) {
    // Priority 4: nobody has it, so use whatever the issue itself provides
    if (hasManualData(manual)) return bookFromManual(title, manual);
    throw error;
  }
};
