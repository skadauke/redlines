# Field notes

A *plain* Markdown file, with **bold**, ~~struck~~ text, `inline code`, a [link](https://example.com/notes) and an autolink: https://example.org.

## Lists

- First item
- Second item, with a nested list:
  - Nested one
  - Nested two
- [x] A task that is done
- [ ] A task that is not

1. One
2. Two
3. Three

> A quotation, set apart from the text around it.
>
> Its second paragraph.

## Code

```ts
export function greet(name: string): string {
  return `Hello, ${name}`;
}
```

Raw HTML is text, never live: <script>alert('no')</script> and <img src="https://example.com/x.png" onerror="alert(1)">.

An image: ![A red caret on warm paper](icon.png "The icon")

<!-- A note that only the author sees. -->

---

A footnote.[^1]

[^1]: The footnote's text.
