//! Bookmark AI desktop — a native-rendered Native SDK app.
//!
//! The view lives in `app.native`; this file is the logic: `Model`, `Msg`,
//! and `update`. Bookmarks are fetched from the local Bookmark AI server
//! (apps/server) over the effects channel and rendered as native cards.

const std = @import("std");
const runner = @import("runner");
const native_sdk = @import("native_sdk");

pub const panic = std.debug.FullPanic(native_sdk.debug.capturePanic);

const canvas = native_sdk.canvas;
const geometry = native_sdk.geometry;

const canvas_label = "main-canvas";
const window_width: f32 = 1100;
const window_height: f32 = 720;

/// The local Bookmark AI API (apps/server). limit=30 keeps the response
/// far under the 256 KiB effect body cap and the view under widget budgets.
const bookmarks_url = "http://127.0.0.1:4545/api/bookmarks?limit=30";
const search_url_base = "http://127.0.0.1:4545/api/search";
const fetch_key: u64 = 1;
const search_key: u64 = 2;
const open_key_base: u64 = 100;

const max_bookmarks = 30;
const max_categories = 16;

const app_permissions = [_][]const u8{ native_sdk.security.permission_command, native_sdk.security.permission_view };
const shell_views = [_]native_sdk.ShellView{
    .{ .label = canvas_label, .kind = .gpu_surface, .fill = true, .role = "Bookmark library canvas", .accessibility_label = "Bookmark AI", .gpu_backend = .metal, .gpu_pixel_format = .bgra8_unorm, .gpu_present_mode = .timer, .gpu_alpha_mode = .@"opaque", .gpu_color_space = .srgb, .gpu_vsync = true },
};
const shell_windows = [_]native_sdk.ShellWindow{.{
    .label = "main",
    .title = "Bookmark AI",
    .width = window_width,
    .height = window_height,
    .restore_state = false,
    .views = &shell_views,
}};
const shell_scene: native_sdk.ShellConfig = .{ .windows = &shell_windows };

// ------------------------------------------------------------------ model

/// Bounded string storage: the whole Model is fixed-size (`create` demands
/// defaults everywhere, and rebuild bindings return slices into it).
fn Str(comptime capacity: usize) type {
    return struct {
        buf: [capacity]u8 = @splat(0),
        len: u16 = 0,

        const Self = @This();

        pub fn slice(self: *const Self) []const u8 {
            return self.buf[0..self.len];
        }

        pub fn set(self: *Self, value: []const u8) void {
            var take = @min(value.len, capacity);
            // Never cut a UTF-8 codepoint in half when truncating.
            while (take > 0 and take < value.len and (value[take] & 0xC0) == 0x80) take -= 1;
            @memcpy(self.buf[0..take], value[0..take]);
            self.len = @intCast(take);
        }

        pub fn clear(self: *Self) void {
            self.len = 0;
        }

        pub fn isEmpty(self: *const Self) bool {
            return self.len == 0;
        }

        pub fn eql(self: *const Self, other: []const u8) bool {
            return std.mem.eql(u8, self.slice(), other);
        }
    };
}

const BookmarkItem = struct {
    url: Str(512) = .{},
    title: Str(160) = .{},
    description: Str(220) = .{},
    domain: Str(80) = .{},
    site: Str(60) = .{},
    category: Str(40) = .{},
    tags: Str(120) = .{},
    browser: Str(12) = .{},
    device: Str(12) = .{},
    day: Str(10) = .{},
};

const LoadStatus = enum { loading, ready, failed };

/// Which fetch the last load was for — guards late/stale terminal Msgs.
const LoadKind = enum { list, search };

pub const Msg = union(enum) {
    refresh,
    loaded: native_sdk.EffectResponse,
    pick_category: []const u8,
    show_all,
    open_bookmark: i64,
    /// Terminal Msg for the `open <url>` spawn; nothing to do on success.
    opened: native_sdk.EffectExit,
    /// Every text edit in the header search field (elm-style mirror).
    query_changed: canvas.TextInputEvent,
    /// Enter in the search field — run the query against /api/search.
    run_search,
    /// Terminal Msg for the search fetch.
    search_loaded: native_sdk.EffectResponse,

    /// Effect-delivered tags — never dispatched from markup.
    pub const view_unbound = .{ "loaded", "opened", "search_loaded" };
};

pub const Model = struct {
    /// Raw storage the markup never touches directly: `bookmarks` is
    /// iterated through the derived `rows`/`cats` views, `error_text`
    /// binds through the `errorText` accessor, and the scalar state
    /// (`bookmark_count`/`total`/`filter`/`status`) only feeds derived
    /// views like `statusLine`/`rows`/`cats` and the state booleans; the
    /// search state (`search_buffer`/`search_active`/`awaiting`) feeds
    /// `searchText`/`headerTitle`/`statusLine` and the empty-state fns.
    pub const view_unbound = .{ "bookmarks", "error_text", "bookmark_count", "total", "filter", "status", "search_buffer", "search_active", "awaiting" };

    bookmarks: [max_bookmarks]BookmarkItem = @splat(.{}),
    bookmark_count: u16 = 0,
    /// Total on the server (may exceed what we fetched).
    total: i64 = 0,
    filter: Str(40) = .{},
    status: LoadStatus = .loading,
    error_text: Str(160) = .{},
    /// Header search field state (markup binds the `searchText` fn).
    search_buffer: canvas.TextBuffer(80) = .{},
    /// True while `bookmarks` holds /api/search results, not the library.
    search_active: bool = false,
    awaiting: LoadKind = .list,

    // ------------------------------------------------------- view bindings

    pub fn isLoading(model: *const Model) bool {
        return model.status == .loading;
    }

    pub fn hasFailed(model: *const Model) bool {
        return model.status == .failed;
    }

    pub fn showEmpty(model: *const Model) bool {
        return model.status == .ready and model.visibleCount() == 0;
    }

    pub fn showList(model: *const Model) bool {
        return model.status == .ready and model.visibleCount() > 0;
    }

    pub fn allSelected(model: *const Model) bool {
        return model.filter.isEmpty();
    }

    pub fn errorText(model: *const Model) []const u8 {
        return model.error_text.slice();
    }

    pub fn searchText(model: *const Model) []const u8 {
        return model.search_buffer.text();
    }

    pub fn emptyTitle(model: *const Model) []const u8 {
        return if (model.search_active) "No matches" else "No bookmarks yet";
    }

    pub fn emptyHint(model: *const Model) []const u8 {
        return if (model.search_active)
            "Try different words, or clear the search to browse the library."
        else
            "Save a page with the browser extension or the web app, then refresh.";
    }

    pub fn headerTitle(model: *const Model, arena: std.mem.Allocator) []const u8 {
        if (model.search_active) {
            return std.fmt.allocPrint(arena, "Search \"{s}\"", .{model.search_buffer.text()}) catch "Search";
        }
        return if (model.filter.isEmpty()) "All bookmarks" else model.filter.slice();
    }

    pub fn statusLine(model: *const Model, arena: std.mem.Allocator) []const u8 {
        return switch (model.status) {
            .loading => if (model.awaiting == .search) "Searching…" else "Loading bookmarks…",
            .failed => "Offline — is the Bookmark AI server running on localhost:4545?",
            .ready => if (model.search_active)
                std.fmt.allocPrint(arena, "{d} {s} · localhost:4545", .{
                    model.visibleCount(),
                    if (model.visibleCount() == 1) "result" else "results",
                }) catch ""
            else
                std.fmt.allocPrint(arena, "{d} shown · {d} total · localhost:4545", .{
                    model.visibleCount(), model.total,
                }) catch "",
        };
    }

    fn visibleCount(model: *const Model) usize {
        var count: usize = 0;
        for (model.bookmarks[0..model.bookmark_count]) |*b| {
            if (model.matches(b)) count += 1;
        }
        return count;
    }

    fn matches(model: *const Model, b: *const BookmarkItem) bool {
        return model.filter.isEmpty() or b.category.eql(model.filter.slice());
    }

    pub const Row = struct {
        index: i64,
        title: []const u8,
        description: []const u8,
        site_line: []const u8,
        category: []const u8,
        tags: []const u8,
        meta: []const u8,
        has_description: bool,
        has_tags: bool,
    };

    /// Cards for the current filter. String fields point into model storage
    /// or the build arena — both outlive the view build.
    pub fn rows(model: *const Model, arena: std.mem.Allocator) []const Row {
        const out = arena.alloc(Row, model.bookmark_count) catch return &.{};
        var count: usize = 0;
        for (model.bookmarks[0..model.bookmark_count], 0..) |*b, i| {
            if (!model.matches(b)) continue;
            const site = if (b.site.isEmpty()) b.domain.slice() else b.site.slice();
            out[count] = .{
                .index = @intCast(i),
                .title = b.title.slice(),
                .description = b.description.slice(),
                .site_line = std.fmt.allocPrint(arena, "{s} · {s}", .{ site, b.domain.slice() }) catch b.domain.slice(),
                .category = b.category.slice(),
                .tags = b.tags.slice(),
                .meta = std.fmt.allocPrint(arena, "{s} · {s} · {s}", .{
                    b.browser.slice(), b.device.slice(), b.day.slice(),
                }) catch "",
                .has_description = !b.description.isEmpty(),
                .has_tags = !b.tags.isEmpty(),
            };
            count += 1;
        }
        return out[0..count];
    }

    pub const CatRow = struct {
        name: []const u8,
        label: []const u8,
        selected: bool,
    };

    /// Unique categories with counts, derived from the loaded bookmarks.
    pub fn cats(model: *const Model, arena: std.mem.Allocator) []const CatRow {
        var names: [max_categories][]const u8 = undefined;
        var counts: [max_categories]usize = @splat(0);
        var unique: usize = 0;
        for (model.bookmarks[0..model.bookmark_count]) |*b| {
            const name = b.category.slice();
            if (name.len == 0) continue;
            const found = for (names[0..unique], 0..) |existing, i| {
                if (std.mem.eql(u8, existing, name)) break i;
            } else blk: {
                if (unique == max_categories) continue;
                names[unique] = name;
                unique += 1;
                break :blk unique - 1;
            };
            counts[found] += 1;
        }

        const out = arena.alloc(CatRow, unique) catch return &.{};
        for (out, names[0..unique], counts[0..unique]) |*row, name, count| {
            row.* = .{
                .name = name,
                .label = std.fmt.allocPrint(arena, "{s}  ({d})", .{ name, count }) catch name,
                .selected = model.filter.eql(name),
            };
        }
        return out;
    }
};

// ----------------------------------------------------------------- update

const BookmarksApp = native_sdk.UiApp(Model, Msg);
const Effects = BookmarksApp.Effects;

pub fn update(model: *Model, msg: Msg, fx: *Effects) void {
    switch (msg) {
        .refresh => startLoad(model, fx),
        .loaded => |response| if (model.awaiting == .list) applyResponse(model, response),
        .pick_category => |name| model.filter.set(name),
        .show_all => model.filter.clear(),
        .open_bookmark => |index| openBookmark(model, fx, index),
        .opened => {},
        .query_changed => |edit| {
            model.search_buffer.apply(edit);
            // The field's built-in clear (x / Escape) empties the text —
            // restore the library instead of showing stale results.
            if (model.search_active and model.search_buffer.text().len == 0) startLoad(model, fx);
        },
        .run_search => startSearch(model, fx),
        .search_loaded => |response| if (model.awaiting == .search) applySearchResponse(model, response),
    }
}

/// Boot-time fetch (TEA init command): runs once before the first paint.
pub fn boot(model: *Model, fx: *Effects) void {
    startLoad(model, fx);
}

fn startLoad(model: *Model, fx: *Effects) void {
    model.status = .loading;
    model.error_text.clear();
    model.search_active = false;
    model.search_buffer.clear();
    model.awaiting = .list;
    fx.fetch(.{
        .key = fetch_key,
        .url = bookmarks_url,
        .timeout_ms = 10_000,
        .on_response = Effects.responseMsg(.loaded),
    });
}

fn startSearch(model: *Model, fx: *Effects) void {
    const query = model.search_buffer.text();
    if (query.len == 0) {
        startLoad(model, fx);
        return;
    }
    model.status = .loading;
    model.error_text.clear();
    model.awaiting = .search;
    var url_buf: [640]u8 = undefined;
    const url = buildSearchUrl(&url_buf, query) catch {
        model.status = .failed;
        model.error_text.set("That search is too long to send.");
        return;
    };
    fx.cancel(search_key); // replace any in-flight search on rapid re-submit
    fx.fetch(.{
        .key = search_key,
        .url = url,
        .timeout_ms = 10_000,
        .on_response = Effects.responseMsg(.search_loaded),
    });
}

/// Build the /api/search URL, percent-encoding the query (pub for tests).
pub fn buildSearchUrl(buf: []u8, query: []const u8) ![]const u8 {
    const prefix = search_url_base ++ "?mode=hybrid&limit=30&q=";
    if (prefix.len > buf.len) return error.QueryTooLong;
    @memcpy(buf[0..prefix.len], prefix);
    var len: usize = prefix.len;
    const hex = "0123456789ABCDEF";
    for (query) |c| {
        switch (c) {
            'A'...'Z', 'a'...'z', '0'...'9', '-', '_', '.', '~' => {
                if (len + 1 > buf.len) return error.QueryTooLong;
                buf[len] = c;
                len += 1;
            },
            ' ' => {
                if (len + 1 > buf.len) return error.QueryTooLong;
                buf[len] = '+';
                len += 1;
            },
            else => {
                if (len + 3 > buf.len) return error.QueryTooLong;
                buf[len] = '%';
                buf[len + 1] = hex[c >> 4];
                buf[len + 2] = hex[c & 0x0F];
                len += 3;
            },
        }
    }
    return buf[0..len];
}

fn openBookmark(model: *Model, fx: *Effects, index: i64) void {
    if (index < 0 or index >= model.bookmark_count) return;
    const b = &model.bookmarks[@intCast(index)];
    if (b.url.isEmpty()) return;
    fx.spawn(.{
        .key = open_key_base + @as(u64, @intCast(index)),
        .argv = &.{ "open", b.url.slice() },
        .on_exit = Effects.exitMsg(.opened),
    });
}

/// Pure and directly testable: fold one terminal fetch outcome into the model.
pub fn applyResponse(model: *Model, response: native_sdk.EffectResponse) void {
    if (response.outcome != .ok) {
        model.status = .failed;
        model.error_text.set(switch (response.outcome) {
            .connect_failed => "Could not connect to the Bookmark AI server. Start it with: pnpm --filter @bookmark-ai/server dev",
            .timed_out => "The server took too long to respond.",
            else => "The request to the server failed.",
        });
        return;
    }
    if (response.status != 200) {
        model.status = .failed;
        model.error_text.set("The server returned an unexpected status.");
        return;
    }
    parseBookmarks(model, response.body) catch {
        model.status = .failed;
        model.error_text.set("Could not read the server response.");
    };
}

/// Pure and directly testable: fold one search fetch outcome into the model.
pub fn applySearchResponse(model: *Model, response: native_sdk.EffectResponse) void {
    if (response.outcome == .cancelled) return; // superseded by a newer search
    if (response.outcome != .ok or response.status != 200) {
        model.status = .failed;
        model.error_text.set("Search failed. Is the Bookmark AI server running on localhost:4545?");
        return;
    }
    parseSearchResults(model, response.body) catch {
        model.status = .failed;
        model.error_text.set("Could not read the search response.");
        return;
    };
    model.search_active = true;
}

// ------------------------------------------------------------ JSON intake

fn parseBookmarks(model: *Model, body: []const u8) !void {
    var arena_state = std.heap.ArenaAllocator.init(std.heap.page_allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();

    const root = try std.json.parseFromSliceLeaky(std.json.Value, arena, body, .{});
    if (root != .object) return error.BadShape;
    const list = root.object.get("bookmarks") orelse return error.BadShape;
    if (list != .array) return error.BadShape;

    model.bookmark_count = 0;
    for (list.array.items) |item| {
        if (model.bookmark_count >= max_bookmarks) break;
        if (item != .object) continue;
        fillItem(&model.bookmarks[model.bookmark_count], item.object);
        model.bookmark_count += 1;
    }

    model.total = if (root.object.get("total")) |total| switch (total) {
        .integer => |n| n,
        else => model.bookmark_count,
    } else model.bookmark_count;

    model.status = .ready;
}

/// /api/search wraps each bookmark as {bookmark, score}; unwrap and reuse
/// the same field intake as the list endpoint.
fn parseSearchResults(model: *Model, body: []const u8) !void {
    var arena_state = std.heap.ArenaAllocator.init(std.heap.page_allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();

    const root = try std.json.parseFromSliceLeaky(std.json.Value, arena, body, .{});
    if (root != .object) return error.BadShape;
    const list = root.object.get("results") orelse return error.BadShape;
    if (list != .array) return error.BadShape;

    model.bookmark_count = 0;
    for (list.array.items) |item| {
        if (model.bookmark_count >= max_bookmarks) break;
        if (item != .object) continue;
        const bookmark = item.object.get("bookmark") orelse continue;
        if (bookmark != .object) continue;
        fillItem(&model.bookmarks[model.bookmark_count], bookmark.object);
        model.bookmark_count += 1;
    }
    model.total = model.bookmark_count;
    model.status = .ready;
}

fn fillItem(b: *BookmarkItem, obj: std.json.ObjectMap) void {
    b.* = .{};
    b.url.set(getString(obj, "url"));
    b.title.set(getString(obj, "title"));
    b.description.set(getString(obj, "description"));
    b.domain.set(getString(obj, "domain"));
    b.category.set(getString(obj, "category"));

    if (obj.get("source")) |source| if (source == .object) {
        b.browser.set(getString(source.object, "browser"));
        b.device.set(getString(source.object, "device"));
        const saved_at = getString(source.object, "savedAt");
        b.day.set(saved_at[0..@min(saved_at.len, 10)]);
    };

    if (obj.get("og")) |og| if (og == .object) {
        b.site.set(getString(og.object, "siteName"));
    };

    if (obj.get("tags")) |tags| if (tags == .array) {
        setTagsLine(&b.tags, tags.array.items);
    };
}

fn getString(obj: std.json.ObjectMap, key: []const u8) []const u8 {
    const value = obj.get(key) orelse return "";
    return switch (value) {
        .string => |s| s,
        else => "",
    };
}

/// Join tags as "#one  #two" into bounded storage, dropping what won't fit.
fn setTagsLine(out: anytype, items: []const std.json.Value) void {
    out.clear();
    var len: usize = 0;
    const capacity = out.buf.len;
    for (items) |item| {
        if (item != .string) continue;
        const tag = item.string;
        const needed = tag.len + 1 + @as(usize, if (len == 0) 0 else 2);
        if (len + needed > capacity) break;
        if (len != 0) {
            @memcpy(out.buf[len..][0..2], "  ");
            len += 2;
        }
        out.buf[len] = '#';
        len += 1;
        @memcpy(out.buf[len..][0..tag.len], tag);
        len += tag.len;
    }
    out.len = @intCast(len);
}

// ------------------------------------------------------------------- view

pub const AppUi = canvas.Ui(Msg);
pub const app_markup = @embedFile("app.native");

// -------------------------------------------------------------------- app

pub fn initialModel() Model {
    return .{};
}

pub fn main(init: std.process.Init) !void {
    // `create` heap-allocates the multi-MB app struct and constructs the
    // Model in place — neither ever rides the stack.
    const app_state = try BookmarksApp.create(std.heap.page_allocator, .{
        .name = "bookmark-ai",
        .scene = shell_scene,
        .canvas_label = canvas_label,
        .update_fx = update,
        .init_fx = boot,
        .markup = .{ .source = app_markup, .watch_path = "src/app.native", .io = init.io },
    });
    defer app_state.destroy();
    app_state.model = initialModel();

    try runner.runWithOptions(app_state.app(), .{
        .app_name = "bookmark-ai",
        .window_title = "Bookmark AI",
        .bundle_id = "ai.bookmark.desktop",
        .icon_path = "assets/icon.png",
        .default_frame = geometry.RectF.init(0, 0, window_width, window_height),
        .restore_state = false,
        .js_window_api = false,
        .security = .{
            .permissions = &app_permissions,
            .navigation = .{ .allowed_origins = &.{ "zero://inline", "zero://app" } },
        },
    }, init);
}

test {
    _ = @import("tests.zig");
}
