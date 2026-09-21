export function slugify(value) {
  return (
    String(value || "untitled")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 60) || "untitled"
  );
}

export function publicationPrefix(index) {
  return `thought-${String(index).padStart(3, "0")}-`;
}

export function publicationDirectoryName(index, title) {
  return `${publicationPrefix(index)}${slugify(title)}`;
}

export function pageName(value) {
  const page = Number(value);
  if (!Number.isInteger(page) || page < 1) return null;
  return String(page).padStart(2, "0");
}
