import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { createLogger } from "../src/logger";

test("logger writes JSON fields to the matching console method", () => {
    const infoLines: string[] = [];
    const warnLines: string[] = [];
    const errorLines: string[] = [];
    const debugLines: string[] = [];

    const original = {
        log: console.log,
        warn: console.warn,
        error: console.error,
        debug: console.debug,
    };

    console.log = ((message?: unknown) => {
        infoLines.push(String(message));
    }) as typeof console.log;
    console.warn = ((message?: unknown) => {
        warnLines.push(String(message));
    }) as typeof console.warn;
    console.error = ((message?: unknown) => {
        errorLines.push(String(message));
    }) as typeof console.error;
    console.debug = ((message?: unknown) => {
        debugLines.push(String(message));
    }) as typeof console.debug;

    try {
        const log = createLogger("providers-test");
        log.info("info message", { requestId: "abc" });
        log.warn("warn message");
        log.error("error message", { code: 500 });
        log.debug("debug message");

        const info = JSON.parse(infoLines[0] || "{}") as Record<
            string,
            unknown
        >;
        assert.equal(info.level, "info");
        assert.equal(info.component, "providers-test");
        assert.equal(info.message, "info message");
        assert.deepEqual(info.meta, { requestId: "abc" });
        assert.equal(typeof info.timestamp, "string");

        const warn = JSON.parse(warnLines[0] || "{}") as Record<
            string,
            unknown
        >;
        assert.equal(warn.level, "warn");
        assert.equal(warn.message, "warn message");
        assert.equal("meta" in warn, false);

        const error = JSON.parse(errorLines[0] || "{}") as Record<
            string,
            unknown
        >;
        assert.equal(error.level, "error");
        assert.deepEqual(error.meta, { code: 500 });

        if (debugLines.length > 0) {
            const debug = JSON.parse(debugLines[0] || "{}") as Record<
                string,
                unknown
            >;
            assert.equal(debug.level, "debug");
            assert.equal(debug.message, "debug message");
        }
    } finally {
        console.log = original.log;
        console.warn = original.warn;
        console.error = original.error;
        console.debug = original.debug;
    }
});

test("LOG_LEVEL suppresses lower-severity logs in a child process", (t) => {
    const loggerModule = path.resolve(__dirname, "../src/logger.js");
    const script = `
        const { createLogger } = require(${JSON.stringify(loggerModule)});
        const log = createLogger("child-logger");
        log.debug("should-be-hidden");
        log.info("should-be-visible");
        log.error("should-also-be-visible");
    `;

    const result = spawnSync(process.execPath, ["-e", script], {
        encoding: "utf8",
        env: {
            ...process.env,
            LOG_LEVEL: "info",
            NODE_ENV: "production",
        },
    });

    if ((result.error as NodeJS.ErrnoException | undefined)?.code === "EPERM") {
        t.skip("The local sandbox does not permit nested process creation");
        return;
    }

    assert.ifError(result.error);
    assert.equal(
        result.status,
        0,
        `Child process failed with stderr: ${result.stderr}`
    );

    const output = `${result.stdout}\n${result.stderr}`
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
            try {
                return JSON.parse(line) as {
                    level?: string;
                    message?: string;
                };
            } catch {
                return null;
            }
        })
        .filter((entry): entry is { level?: string; message?: string } =>
            Boolean(entry)
        );

    assert.equal(
        output.some((entry) => entry.message === "should-be-hidden"),
        false
    );
    assert.equal(
        output.some(
            (entry) =>
                entry.level === "info" && entry.message === "should-be-visible"
        ),
        true
    );
    assert.equal(
        output.some(
            (entry) =>
                entry.level === "error" &&
                entry.message === "should-also-be-visible"
        ),
        true
    );
});
