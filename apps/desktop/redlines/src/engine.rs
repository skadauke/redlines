//! The command line's logic, which is the TypeScript of `packages/cli` and `@redlines/format`,
//! bundled (`bundle/redlines.js`) and run in QuickJS, so that there is one implementation of the
//! format. `packages/cli/src/quickjs-entry.ts` is the other side of this file: it says what the
//! global `__host` has to do, and defines the `redlinesMain` that is called here.

use rquickjs::function::{Func, Opt};
use rquickjs::{
    Coerced, Context, Ctx, Error, Exception, Function, Object, Promise, Result, Runtime, TypedArray,
};
use std::ffi::CString;
use std::fs::{self, OpenOptions, Permissions};
use std::io::{self, Read, Write};
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::time::{SystemTime, UNIX_EPOCH};

const BUNDLE: &str = include_str!("../bundle/redlines.js");

/// The most stack QuickJS may use, of the 8 MiB that the system gives the main thread.
const MAX_STACK: usize = 4 * 1024 * 1024;

/// The exit code of a failure of the program itself, as in `quickjs-entry.ts`.
const FAILED: i32 = 70;

/// Runs the command line and gives its exit code.
pub fn run(args: &[String]) -> i32 {
    match execute(args) {
        Ok(code) => code,
        Err(reason) => {
            crate::print_error(&format!("redlines: {reason}"));
            FAILED
        }
    }
}

fn execute(args: &[String]) -> std::result::Result<i32, String> {
    let runtime = Runtime::new().map_err(|error| error.to_string())?;
    runtime.set_max_stack_size(MAX_STACK);
    let context = Context::full(&runtime).map_err(|error| error.to_string())?;
    context.with(|ctx| call_main(&ctx, args).map_err(|error| reason_of(&ctx, error)))
}

/// Every method of the host is synchronous, so the promise of `redlinesMain` waits only for jobs of
/// its own, which `finish` runs until it settles.
fn call_main(ctx: &Ctx<'_>, args: &[String]) -> Result<i32> {
    let globals = ctx.globals();
    globals.set("__host", host(ctx)?)?;
    globals.set("crypto", crypto(ctx)?)?;
    ctx.eval::<(), _>(BUNDLE)?;
    let main: Function = globals.get("redlinesMain")?;
    let exit_code: Promise = main.call((args.to_vec(),))?;
    exit_code.finish()
}

/// Why something failed that the logic didn't catch.
fn reason_of(ctx: &Ctx<'_>, error: Error) -> String {
    if !error.is_exception() {
        return error.to_string();
    }
    let thrown = ctx.catch();
    let message = thrown.as_exception().and_then(Exception::message);
    message
        .or_else(|| thrown.get::<Coerced<String>>().ok().map(|text| text.0))
        .unwrap_or_else(|| "an unknown failure".to_owned())
}

fn host<'js>(ctx: &Ctx<'js>) -> Result<Object<'js>> {
    let host = Object::new(ctx.clone())?;
    host.set("readFile", Func::from(read_file))?;
    host.set("writeFile", Func::from(write_file))?;
    host.set("stdout", Func::from(stdout))?;
    host.set("stderr", Func::from(stderr))?;
    host.set("nowMs", Func::from(now_ms))?;
    host.set("realpath", Func::from(realpath))?;
    host.set("modeOf", Func::from(mode_of))?;
    host.set("canWrite", Func::from(can_write))?;
    host.set("rename", Func::from(rename))?;
    host.set("remove", Func::from(remove))?;
    host.set("readStdin", Func::from(read_stdin))?;
    host.set("randomHex", Func::from(random_hex))?;
    Ok(host)
}

/// What `@redlines/format` draws its ids from. QuickJS has no `crypto` of its own.
fn crypto<'js>(ctx: &Ctx<'js>) -> Result<Object<'js>> {
    let crypto = Object::new(ctx.clone())?;
    crypto.set("getRandomValues", Func::from(get_random_values))?;
    Ok(crypto)
}

/// A failure of the machine, as the `Error` that the logic is told about.
fn thrown(ctx: &Ctx<'_>, error: &io::Error) -> Error {
    Exception::throw_message(ctx, &crate::os_reason(error))
}

/// The text of bytes, unchanged: a byte order mark stays as U+FEFF. Bytes that aren't UTF-8 are the
/// `Error` named `NotUtf8`, for which the logic says what it can't do with them.
fn text_of(ctx: &Ctx<'_>, bytes: Vec<u8>) -> Result<String> {
    String::from_utf8(bytes).map_err(|_| {
        let not_utf8 = Exception::from_message(ctx.clone(), "not UTF-8 text")
            .and_then(|error| error.as_object().set("name", "NotUtf8").map(|()| error));
        match not_utf8 {
            Ok(error) => error.throw(),
            Err(failure) => failure,
        }
    })
}

fn read_file(ctx: Ctx<'_>, path: String) -> Result<String> {
    let bytes = fs::read(path).map_err(|error| thrown(&ctx, &error))?;
    text_of(&ctx, bytes)
}

/// Writes a file. A new file gets the permissions `mode`, which the umask doesn't cut down, as it
/// does for the mode given to `open`.
fn write_file(ctx: Ctx<'_>, path: String, text: String, mode: Opt<Option<u32>>) -> Result<()> {
    let mode = mode.0.flatten();
    let mut options = OpenOptions::new();
    options.write(true).create(true).truncate(true);
    if let Some(mode) = mode {
        options.mode(mode);
    }
    let written = options.open(path).and_then(|mut file| {
        file.write_all(text.as_bytes())?;
        match mode {
            Some(mode) => file.set_permissions(Permissions::from_mode(mode)),
            None => Ok(()),
        }
    });
    written.map_err(|error| thrown(&ctx, &error))
}

/// Writes all of `text` now, so that nothing is left to flush when the program ends. A reader that
/// stops reading, as `head` does after its first line, closes the pipe, which is no failure of
/// ours.
fn print(ctx: &Ctx<'_>, mut stream: impl Write, text: &str) -> Result<()> {
    match stream
        .write_all(text.as_bytes())
        .and_then(|()| stream.flush())
    {
        Err(error) if error.kind() != io::ErrorKind::BrokenPipe => Err(thrown(ctx, &error)),
        _ => Ok(()),
    }
}

fn stdout(ctx: Ctx<'_>, text: String) -> Result<()> {
    print(&ctx, io::stdout().lock(), &text)
}

fn stderr(ctx: Ctx<'_>, text: String) -> Result<()> {
    print(&ctx, io::stderr().lock(), &text)
}

fn now_ms() -> f64 {
    let now = SystemTime::now().duration_since(UNIX_EPOCH);
    now.map_or(0.0, |since| since.as_millis() as f64)
}

fn realpath(ctx: Ctx<'_>, path: String) -> Result<String> {
    let real = fs::canonicalize(path).map_err(|error| thrown(&ctx, &error))?;
    real.into_os_string()
        .into_string()
        .map_err(|_| Exception::throw_message(&ctx, "its real path isn't UTF-8 text"))
}

fn mode_of(ctx: Ctx<'_>, path: String) -> Result<u32> {
    let metadata = fs::metadata(path).map_err(|error| thrown(&ctx, &error))?;
    Ok(metadata.permissions().mode() & 0o7777)
}

/// Whether the file can be written to, as the system answers it, which asks about the user and the
/// disk as well as the mode. Not being allowed to is an answer; a file that isn't there is not.
fn can_write(ctx: Ctx<'_>, path: String) -> Result<bool> {
    let path = CString::new(path)
        .map_err(|_| Exception::throw_message(&ctx, "a path can't hold a NUL"))?;
    // SAFETY: `path` is a string that ends in a NUL, and `access` only reads it during the call.
    if unsafe { libc::access(path.as_ptr(), libc::W_OK) } == 0 {
        return Ok(true);
    }
    let error = io::Error::last_os_error();
    match error.raw_os_error() {
        Some(libc::EACCES | libc::EPERM | libc::EROFS) => Ok(false),
        _ => Err(thrown(&ctx, &error)),
    }
}

fn rename(ctx: Ctx<'_>, from: String, to: String) -> Result<()> {
    fs::rename(from, to).map_err(|error| thrown(&ctx, &error))
}

fn remove(ctx: Ctx<'_>, path: String) -> Result<()> {
    fs::remove_file(path).map_err(|error| thrown(&ctx, &error))
}

fn read_stdin(ctx: Ctx<'_>) -> Result<String> {
    let mut bytes = Vec::new();
    io::stdin()
        .read_to_end(&mut bytes)
        .map_err(|error| thrown(&ctx, &error))?;
    text_of(&ctx, bytes)
}

/// Fills `bytes` from the operating system.
fn fill_random(ctx: &Ctx<'_>, bytes: &mut [u8]) -> Result<()> {
    getrandom::fill(bytes).map_err(|error| Exception::throw_message(ctx, &error.to_string()))
}

/// `n` random bytes as `2 * n` lowercase hexadecimal digits.
fn random_hex(ctx: Ctx<'_>, n: u32) -> Result<String> {
    let mut bytes = vec![0; n as usize];
    fill_random(&ctx, &mut bytes)?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

/// `crypto.getRandomValues`, for the only array the logic gives it.
fn get_random_values<'js>(
    ctx: Ctx<'js>,
    array: TypedArray<'js, u8>,
) -> Result<TypedArray<'js, u8>> {
    let mut bytes = vec![0; array.len()];
    fill_random(&ctx, &mut bytes)?;
    for (index, byte) in (0u32..).zip(bytes) {
        array.as_object().set(index, byte)?;
    }
    Ok(array)
}
