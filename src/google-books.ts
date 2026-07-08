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
  eng: "en", fra: "fr", deu: "de", spa: "es", ita: "it",
  por: "pt", rus: "ru", jpn: "ja", zho: "zh", kor: "ko",
  hin: "hi", ara: "ar", nld: "nl", swe: "sv", pol: "pl",
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
 * Search Open Library API (free, no key required)
 */
const searchOpenLibrary = async (q: string): Promise<BookResult> => {
  console.log(`bookshelf-action: trying Open Library for "${q}"`);

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

  // Try to get ISBN from edition if not in search results
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
    } catch (e) {
      // Edition lookup failed, continue without ISBN
    }
  }

  // Get publisher from edition if available
  let publisher = "";
  if (doc.publisher && doc.publisher.length > 0) {
    publisher = doc.publisher[0];
  }

  // Fallback image using Bing if no cover found
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
    language: mapLanguageCode(doc.language?.[0] || "en"),
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

/**
 * Search for a book — tries Google Books first, falls back to Open Library
 */
export const search = async (q: string): Promise<BookResult> => {
  // Try Google Books first
  try {
    return await searchGoogleBooks(q);
  } catch (error) {
    console.log(`bookshelf-action: Google Books failed (${error}), trying Open Library...`);
  }

  // Fallback to Open Library
  return await searchOpenLibrary(q);
};
