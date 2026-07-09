const std = @import("std");
const native_sdk = @import("native_sdk");
const main = @import("main.zig");

const canvas = native_sdk.canvas;
const testing = std.testing;

const AppUi = main.AppUi;
const Model = main.Model;
const Msg = main.Msg;

const AppMarkup = canvas.MarkupView(Model, Msg);

const sample_body =
    \\{"bookmarks":[
    \\  {"id":"a","url":"https://github.com/vercel-labs/native","domain":"github.com",
    \\   "title":"vercel-labs/native","description":"Toolkit for building native desktop apps.",
    \\   "og":{"siteName":"GitHub"},
    \\   "source":{"browser":"chrome","device":"laptop","savedAt":"2026-07-09T09:13:31.326Z"},
    \\   "category":"Development","tags":["github","zig"],"createdAt":"x","embedded":false},
    \\  {"id":"b","url":"https://figma.com/file","domain":"figma.com",
    \\   "title":"Design file","description":"",
    \\   "og":{},
    \\   "source":{"browser":"safari","device":"tablet","savedAt":"2026-07-08T10:00:00.000Z"},
    \\   "category":"Design","tags":[],"createdAt":"x","embedded":true}
    \\],"total":42}
;

fn loadedModel() Model {
    var model = main.initialModel();
    main.applyResponse(&model, .{ .key = 1, .outcome = .ok, .status = 200, .body = sample_body });
    return model;
}

fn buildTree(arena: std.mem.Allocator, model: *const Model) !AppUi.Tree {
    var view = try AppMarkup.init(arena, main.app_markup);
    var ui = AppUi.init(arena);
    const node = view.build(&ui, model) catch |err| {
        // Name the app.native position instead of leaving a bare error
        // trace: the usual causes are a binding without a matching
        // Model field or an on-* message without a Msg arm.
        if (err == error.MarkupBuild) {
            std.debug.print("app.native:{d}:{d}: {s}\n", .{ view.diagnostic.line, view.diagnostic.column, view.diagnostic.message });
        }
        return err;
    };
    return ui.finalize(node);
}

fn findByText(widget: canvas.Widget, kind: canvas.WidgetKind, text: []const u8) ?canvas.Widget {
    if (widget.kind == kind and std.mem.eql(u8, widget.text, text)) return widget;
    for (widget.children) |child| {
        if (findByText(child, kind, text)) |found| return found;
    }
    return null;
}

fn expectByText(widget: canvas.Widget, kind: canvas.WidgetKind, text: []const u8) !canvas.Widget {
    return findByText(widget, kind, text) orelse {
        std.debug.print("no {t} with text \"{s}\" in the view - if you changed app.native, update this test to match\n", .{ kind, text });
        return error.WidgetNotFound;
    };
}

test "a successful response fills the model" {
    var model = loadedModel();

    try testing.expectEqual(@as(u16, 2), model.bookmark_count);
    try testing.expectEqual(@as(i64, 42), model.total);
    try testing.expect(model.showList());
    try testing.expect(!model.isLoading());

    const first = &model.bookmarks[0];
    try testing.expectEqualStrings("vercel-labs/native", first.title.slice());
    try testing.expectEqualStrings("Development", first.category.slice());
    try testing.expectEqualStrings("chrome", first.browser.slice());
    try testing.expectEqualStrings("2026-07-09", first.day.slice());
    try testing.expectEqualStrings("#github  #zig", first.tags.slice());
    try testing.expectEqualStrings("GitHub", first.site.slice());
}

test "a failed fetch reports the offline state" {
    var model = main.initialModel();
    main.applyResponse(&model, .{ .key = 1, .outcome = .connect_failed });

    try testing.expect(model.hasFailed());
    try testing.expect(model.errorText().len > 0);
}

test "malformed bodies fail without crashing" {
    var model = main.initialModel();
    main.applyResponse(&model, .{ .key = 1, .outcome = .ok, .status = 200, .body = "not json {" });
    try testing.expect(model.hasFailed());

    main.applyResponse(&model, .{ .key = 1, .outcome = .ok, .status = 200, .body = "{\"unexpected\":true}" });
    try testing.expect(model.hasFailed());
}

test "category filter narrows the rows and derives facet counts" {
    var arena_state = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();

    var model = loadedModel();

    const all = model.rows(arena);
    try testing.expectEqual(@as(usize, 2), all.len);

    const facets = model.cats(arena);
    try testing.expectEqual(@as(usize, 2), facets.len);
    try testing.expectEqualStrings("Development", facets[0].name);
    try testing.expect(!facets[0].selected);

    model.filter.set("Design");
    const filtered = model.rows(arena);
    try testing.expectEqual(@as(usize, 1), filtered.len);
    try testing.expectEqualStrings("Design file", filtered[0].title);
    try testing.expectEqualStrings("Design", model.headerTitle(arena));
}

test "the markup builds against every model state" {
    var arena_state = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();

    // Loading (boot) state.
    var loading = main.initialModel();
    var tree = try buildTree(arena, &loading);
    _ = try expectByText(tree.root, .text, "Bookmark AI");

    // Failed state renders the retry affordance.
    var failed = main.initialModel();
    main.applyResponse(&failed, .{ .key = 1, .outcome = .connect_failed });
    tree = try buildTree(arena, &failed);
    _ = try expectByText(tree.root, .button, "Try again");

    // Ready state renders cards, category rows, and the status bar.
    var ready = loadedModel();
    tree = try buildTree(arena, &ready);
    _ = try expectByText(tree.root, .text, "vercel-labs/native");
    _ = try expectByText(tree.root, .badge, "Development");
    _ = try expectByText(tree.root, .list_item, "Design  (1)");
    _ = try expectByText(tree.root, .status_bar, "2 shown · 42 total · localhost:4000");
}

test "pressing a category row dispatches the typed filter message" {
    var arena_state = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();

    var model = loadedModel();
    var tree = try buildTree(arena, &model);

    const design = try expectByText(tree.root, .list_item, "Design  (1)");
    const msg = tree.msgForPointer(design.id, .up) orelse return error.NoMessage;
    switch (msg) {
        .pick_category => |name| try testing.expectEqualStrings("Design", name),
        else => return error.WrongMessage,
    }

    // Apply it the way update would (the arm is effect-free).
    model.filter.set("Design");
    tree = try buildTree(arena, &model);
    _ = try expectByText(tree.root, .text, "Design file");
    try testing.expectEqual(@as(usize, 1), model.rows(arena).len);
}

const sample_search_body =
    \\{"mode":"text","results":[
    \\  {"bookmark":{"id":"c","url":"https://developer.mozilla.org/fetch","domain":"developer.mozilla.org",
    \\   "title":"Fetch API","description":"Interface for fetching resources.",
    \\   "og":{"siteName":"MDN Web Docs"},
    \\   "source":{"browser":"chrome","device":"laptop","savedAt":"2026-07-09T10:47:28.871Z"},
    \\   "category":"Docs & Reference","tags":["developer"],"createdAt":"x","embedded":true},
    \\   "score":2.14}
    \\]}
;

test "a search response fills the model as results" {
    var arena_state = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();

    var model = loadedModel();
    main.applySearchResponse(&model, .{ .key = 2, .outcome = .ok, .status = 200, .body = sample_search_body });

    try testing.expect(model.search_active);
    try testing.expectEqual(@as(u16, 1), model.bookmark_count);
    try testing.expectEqualStrings("Fetch API", model.bookmarks[0].title.slice());
    try testing.expectEqualStrings("1 result · localhost:4000", model.statusLine(arena));

    // A cancelled terminal (superseded search) must not disturb the model.
    main.applySearchResponse(&model, .{ .key = 2, .outcome = .cancelled });
    try testing.expect(model.search_active);
    try testing.expectEqual(@as(u16, 1), model.bookmark_count);
}

test "buildSearchUrl percent-encodes the query" {
    var buf: [640]u8 = undefined;
    const url = try main.buildSearchUrl(&buf, "zig lang! ünïcode");
    try testing.expectEqualStrings(
        "http://127.0.0.1:4000/api/search?mode=text&limit=30&q=zig+lang%21+%C3%BCn%C3%AFcode",
        url,
    );
}

test "the markup builds in the search state" {
    var arena_state = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();

    var model = loadedModel();
    main.applySearchResponse(&model, .{ .key = 2, .outcome = .ok, .status = 200, .body = sample_search_body });
    var tree = try buildTree(arena, &model);
    _ = try expectByText(tree.root, .text, "Fetch API");
    _ = try expectByText(tree.root, .status_bar, "1 result · localhost:4000");

    // No matches: the empty state speaks search, not onboarding.
    main.applySearchResponse(&model, .{ .key = 2, .outcome = .ok, .status = 200, .body = "{\"mode\":\"text\",\"results\":[]}" });
    tree = try buildTree(arena, &model);
    _ = try expectByText(tree.root, .text, "No matches");
}

test "the view lays out through the canvas engine" {
    var arena_state = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena_state.deinit();

    var model = loadedModel();
    const tree = try buildTree(arena_state.allocator(), &model);

    var nodes: [512]canvas.WidgetLayoutNode = undefined;
    const layout = try canvas.layoutWidgetTree(tree.root, native_sdk.geometry.RectF.init(0, 0, 1100, 720), &nodes);
    try testing.expect(layout.nodes.len > 0);
}
