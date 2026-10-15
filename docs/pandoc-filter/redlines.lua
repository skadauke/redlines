-- Prototype pandoc filter for Redlines (see docs/format.md, section 11).
-- Turns insertions, deletions and substitutions into pandoc's tracked-change
-- spans, so `pandoc sample.md -L redlines.lua -o out.docx` writes real Word
-- tracked changes. Comments, format changes and the other views are not
-- handled yet.
-- It reads authors and dates from an older ledger key, `changes`; the format
-- stores them under `marks`.
local people, marks = {}, {}

local function unescape(s)
  s = s:gsub("\n\\\n", "\n\n"):gsub("\\%-", "-"):gsub("\\`", "`")
  return s
end

local function load_ledger(blocks)
  for i, b in ipairs(blocks) do
    if b.t == "RawBlock" and b.format == "html" then
      local yaml = b.text:match("^<!%-%- redlines\n(.*)\n%-%->%s*$")
      if yaml then
        local meta = pandoc.read("---\n" .. yaml .. "\n---\n", "markdown").meta
        for k, v in pairs(meta.people or {}) do people[k] = pandoc.utils.stringify(v.name) end
        for k, v in pairs(meta.changes or {}) do
          marks[k] = { by = pandoc.utils.stringify(v.by), at = pandoc.utils.stringify(v.at) }
        end
        blocks:remove(i)
        return
      end
    end
  end
end

local function attrs(id, cls)
  local m = marks[id] or {}
  return pandoc.Attr("", { cls }, { author = people[m.by] or "Unknown", date = m.at or "" })
end

local function convert(inlines)
  local out, i = pandoc.List(), 1
  while i <= #inlines do
    local el = inlines[i]
    local kind, id, payload
    if el.t == "RawInline" and el.format == "html" then
      kind, id, payload = el.text:match("^<!%-%-(%a+) (%w+) ?(.-)%-%->$")
    end
    if kind == "del" then
      out:insert(pandoc.Span(pandoc.Inlines(unescape(payload)), attrs(id, "deletion")))
    elseif kind == "ins" or kind == "sub" then
      if kind == "sub" then out:insert(pandoc.Span(pandoc.Inlines(unescape(payload)), attrs(id, "deletion"))) end
      local inner, j = pandoc.List(), i + 1
      while j <= #inlines and not (inlines[j].t == "RawInline" and inlines[j].text == "<!--/" .. id .. "-->") do
        inner:insert(inlines[j]); j = j + 1
      end
      out:insert(pandoc.Span(inner, attrs(id, "insertion")))
      i = j
    else
      out:insert(el)
    end
    i = i + 1
  end
  return out
end

function Pandoc(doc)
  load_ledger(doc.blocks)
  return doc:walk({ Inlines = convert })
end
