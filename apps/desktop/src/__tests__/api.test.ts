import { describe, expect, it } from "vitest";
import { formatSize, hostOf, isInside, parentOf, parseServices, stackState, type ServiceStatus } from "../lib/api";

describe("parseServices", () => {
  it("reads the JSON array of `orazaka status --json`, ignoring noise around it", () => {
    const lines = ["checking…", "[", '  {"name":"Edge","port":8088,"status":"running","pid":1,"category":"app"}', "]", "done"];
    expect(parseServices(lines)).toEqual([{ name: "Edge", port: 8088, status: "running", pid: 1, category: "app" }]);
  });
  it("returns nothing for output that is not JSON", () => {
    expect(parseServices(["boom"])).toEqual([]);
    expect(parseServices(["[not json]"])).toEqual([]);
  });
});

describe("paths", () => {
  it("isInside never matches a sibling that shares a prefix", () => {
    expect(isInside("/Users/a/Docs", "/Users/a/Docs/x.pdf")).toBe(true);
    expect(isInside("/Users/a/Docs", "/Users/a/Docs")).toBe(true);
    expect(isInside("/Users/a/Docs", "/Users/a/Docs-private/x.pdf")).toBe(false);
  });
  it("parentOf", () => {
    expect(parentOf("/Users/a/Docs")).toBe("/Users/a");
    expect(parentOf("/Users")).toBe("/");
  });
});

describe("formatting", () => {
  it("formatSize", () => {
    expect(formatSize(12)).toBe("12 B");
    expect(formatSize(2048)).toBe("2.0 KB");
    expect(formatSize(5 * 1024 ** 2)).toBe("5.0 MB");
  });
  it("hostOf", () => {
    expect(hostOf("https://dev.orazaka.com")).toBe("dev.orazaka.com");
    expect(hostOf("nonsense")).toBe("nonsense");
  });
});

describe("stackState", () => {
  const svc = (status: ServiceStatus["status"]): ServiceStatus => ({ name: "x", port: 1, status, pid: null, category: "app" });
  it("is derived from the services, not from the two probed ports", () => {
    expect(stackState([svc("running"), svc("running")], "stopped")).toBe("running");
    expect(stackState([svc("running"), svc("stopped")], "stopped")).toBe("partial");
    expect(stackState([svc("stopped"), svc("stopped")], "running")).toBe("stopped");
  });
  it("falls back to the probe until the status has been read", () => {
    expect(stackState([], "partial")).toBe("partial");
  });
});
