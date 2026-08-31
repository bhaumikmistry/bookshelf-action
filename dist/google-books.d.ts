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
export declare const selectBestBook: (items: Book[]) => Book;
/** Strip the trailing progress marker, e.g. "Title by Author (42%)" -> "Title by Author". */
export declare const stripProgress: (title: string) => string;
/**
 * Manual metadata written directly in the issue body, for books that neither
 * Google Books nor Open Library knows about. Lines are "key: value", optionally
 * wrapped in a fenced block. Unknown keys are ignored.
 */
export declare const parseManualMetadata: (body: string) => Partial<BookResult>;
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
export declare const search: (title: string, body?: string) => Promise<BookResult>;
