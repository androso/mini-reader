UPDATE "books"
SET "file_type" = CASE
    WHEN "file_key" LIKE 'pdf-%' THEN 'pdf'::"file_type"
    WHEN "file_key" LIKE 'epub-%' THEN 'epub'::"file_type"
END
WHERE
    "file_type" IS NULL
    AND (
        "file_key" LIKE 'pdf-%'
        OR "file_key" LIKE 'epub-%'
    );
