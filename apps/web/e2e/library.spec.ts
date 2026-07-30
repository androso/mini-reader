import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("signup, upload PDF, persist after reload, and delete", async ({
    page,
}) => {
    const suffix = randomUUID().slice(0, 8);
    const email = `smoke_${suffix}@reader.test`;
    const username = `smoke_${suffix.replace(/-/g, "_")}`;
    const password = "SmokeTest1!";

    await page.goto("/login");
    const signupTab = page.getByRole("tab", { name: "Sign up" });
    await expect
        .poll(async () => {
            await signupTab.dispatchEvent("click");
            return signupTab.getAttribute("aria-selected");
        })
        .toBe("true");
    await page.getByLabel("Username").fill(username);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(
        page.getByRole("heading", { name: "Your reading room" })
    ).toBeVisible({ timeout: 30_000 });

    const pdf = Buffer.from(
        "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
    );
    const uploadResponsePromise = page.waitForResponse(
        (response) =>
            response.url().includes("/api/books") &&
            response.request().method() === "POST"
    );
    await page
        .locator('input[aria-label="Choose an EPUB or PDF"]')
        .setInputFiles({
            name: "Smoke Test.pdf",
            mimeType: "application/pdf",
            buffer: pdf,
        });
    const uploadResponse = await uploadResponsePromise;
    expect(uploadResponse.status()).toBe(202);
    const uploadBody = await uploadResponse.json();
    expect(uploadBody).not.toHaveProperty("fileKey");
    expect(uploadBody).not.toHaveProperty("collectionName");

    await expect(page.getByLabel("Open Smoke Test.pdf")).toBeVisible({
        timeout: 30_000,
    });

    await page.reload();
    await expect(
        page.getByRole("heading", { name: "Your reading room" })
    ).toBeVisible();
    await expect(page.getByLabel("Open Smoke Test.pdf")).toBeVisible();

    const deleteResponsePromise = page.waitForResponse(
        (response) =>
            response.url().includes("/api/books/") &&
            response.request().method() === "DELETE"
    );
    await page.getByLabel("Delete Smoke Test.pdf").click();
    const deleteResponse = await deleteResponsePromise;
    expect(deleteResponse.status()).toBe(204);
    await expect(page.getByText("No books here yet")).toBeVisible();
});
