import { parseManualMetadata, stripProgress } from "./google-books";

describe("stripProgress", () => {
  it("removes the trailing progress marker", () => {
    expect(stripProgress("The Enchanted Cottage by Ruskin Bond (0%)")).toBe(
      "The Enchanted Cottage by Ruskin Bond"
    );
  });

  it("leaves titles without a marker alone", () => {
    expect(stripProgress("Norwegian Wood by Haruki Murakami")).toBe(
      "Norwegian Wood by Haruki Murakami"
    );
  });
});

describe("parseManualMetadata", () => {
  it("returns nothing for an empty body", () => {
    expect(parseManualMetadata("")).toEqual({});
  });

  it("ignores an Open Library edition id", () => {
    expect(parseManualMetadata("OL47040160M")).toEqual({});
  });

  it("reads key: value lines, including inside a fence", () => {
    const body = [
      "```yaml",
      "title: The Enchanted Cottage",
      "author: Ruskin Bond",
      "publisher: Penguin India",
      "year: 2022",
      "pages: 96",
      "language: english",
      "isbn: 9780143454168",
      "categories: fiction, india",
      "rating: 3.8",
      "cover: https://example.com/cover.jpg",
      "link: https://books.google.com/example",
      "```",
    ].join("\n");

    expect(parseManualMetadata(body)).toEqual({
      title: "The Enchanted Cottage",
      authors: ["Ruskin Bond"],
      publisher: "Penguin India",
      publishedDate: "2022",
      pageCount: 96,
      language: "en",
      isbn13: "9780143454168",
      categories: ["fiction", "india"],
      averageRating: 3.8,
      image: "https://example.com/cover.jpg",
      googleBooks: {
        id: "",
        preview: "https://books.google.com/example",
        info: "https://books.google.com/example",
        canonical: "https://books.google.com/example",
      },
    });
  });

  it("splits multiple authors and routes a 10-digit isbn", () => {
    const parsed = parseManualMetadata("authors: A Author, B Author\nisbn: 0143454161");
    expect(parsed.authors).toEqual(["A Author", "B Author"]);
    expect(parsed.isbn10).toBe("0143454161");
    expect(parsed.isbn13).toBeUndefined();
  });
});
