//! Export as PDF: the window's printed page (`src/print.ts`, `src/print.css`), paginated by WebKit
//! as the print dialog would, written to a file without any dialog. It is WKWebView's own print
//! operation with the job set to save: the same layout that File > Print shows, which a PDF made
//! any other way (a screenshot of the page, `createPDF`) would not paginate.
//!
//! The operation is run modal for the window, with a delegate that is told when it is done. A
//! plain `runOperation` on a web view never ends: it writes blank pages until the disk is full.

#[cfg(target_os = "macos")]
pub use imp::print_to_pdf;

#[cfg(target_os = "macos")]
mod imp {
    use std::cell::RefCell;
    use std::ffi::c_void;
    use std::sync::mpsc::Sender;

    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, AnyObject, Bool};
    use objc2::{DefinedClass, MainThreadMarker, MainThreadOnly, define_class, msg_send, sel};
    use objc2_foundation::{NSObject, NSObjectProtocol, NSString, NSURL};

    pub struct Done {
        finished: RefCell<Option<Sender<Result<(), String>>>>,
    }

    define_class!(
        /// What the print operation tells when it has run.
        // SAFETY:
        // - The superclass NSObject does not have any subclassing requirements.
        // - `PrintDone` does not implement `Drop`.
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[name = "RedlinesPrintDone"]
        #[ivars = Done]
        struct PrintDone;

        // SAFETY: `NSObjectProtocol` has no safety requirements.
        unsafe impl NSObjectProtocol for PrintDone {}

        impl PrintDone {
            // SAFETY: the selector and its signature are those of the callback of
            // `runOperationModalForWindow:delegate:didRunSelector:contextInfo:`.
            #[unsafe(method(printOperationDidRun:success:contextInfo:))]
            fn did_run(&self, _operation: &AnyObject, success: Bool, _context: *mut c_void) {
                if let Some(finished) = self.ivars().finished.borrow_mut().take() {
                    let _ = finished.send(if success.as_bool() {
                        Ok(())
                    } else {
                        Err("the page could not be printed".to_string())
                    });
                }
            }
        }
    );

    impl PrintDone {
        fn new(mtm: MainThreadMarker, finished: Sender<Result<(), String>>) -> Retained<Self> {
            let this = Self::alloc(mtm).set_ivars(Done {
                finished: RefCell::new(Some(finished)),
            });
            // SAFETY: NSObject's `init`.
            unsafe { msg_send![super(this), init] }
        }
    }

    /// Starts printing the page of the web view `webview` (a `WKWebView`) to the PDF file at
    /// `path`, on the main thread. The operation runs on after this returns, and `finished` is
    /// sent its outcome, with the file written.
    pub fn print_to_pdf(
        webview: *mut c_void,
        path: &str,
        finished: Sender<Result<(), String>>,
    ) -> Result<(), String> {
        let mtm = MainThreadMarker::new().ok_or("not on the main thread")?;
        // SAFETY: `webview` is the window's live WKWebView, and this runs on the main thread (the
        // closure of `with_webview`). Every message below is to an AppKit object that is alive here.
        unsafe {
            let web_view: &AnyObject = (webview as *const AnyObject)
                .as_ref()
                .ok_or("the window has no page")?;
            let window: Option<Retained<AnyObject>> = msg_send![web_view, window];
            let window = window.ok_or("the page has no window")?;
            let class = AnyClass::get(c"NSPrintInfo").ok_or("no print info")?;
            let shared: *mut AnyObject = msg_send![class, sharedPrintInfo];
            // A copy: the shared print info is the person's own settings, and stays as it is.
            let info: Option<Retained<AnyObject>> = msg_send![shared, copy];
            let info = info.ok_or("no print info")?;
            let url = NSURL::fileURLWithPath(&NSString::from_str(path));
            let disposition = NSString::from_str("NSPrintSaveJob");
            let dictionary: *mut AnyObject = msg_send![&*info, dictionary];
            let key = NSString::from_str("NSJobSavingURL");
            let _: () = msg_send![dictionary, setObject: &*url, forKey: &*key];
            let _: () = msg_send![&*info, setJobDisposition: &*disposition];
            // An inch all round, in points, as Word's default and the page's `@page` (print.css).
            let margin: f64 = 72.0;
            let _: () = msg_send![&*info, setTopMargin: margin];
            let _: () = msg_send![&*info, setBottomMargin: margin];
            let _: () = msg_send![&*info, setLeftMargin: margin];
            let _: () = msg_send![&*info, setRightMargin: margin];
            let _: () = msg_send![&*info, setVerticallyCentered: Bool::NO];
            let operation: Option<Retained<AnyObject>> =
                msg_send![web_view, printOperationWithPrintInfo: &*info];
            let operation = operation.ok_or("the page can't be printed")?;
            let _: () = msg_send![&*operation, setShowsPrintPanel: Bool::NO];
            let _: () = msg_send![&*operation, setShowsProgressPanel: Bool::NO];
            let delegate = PrintDone::new(mtm, finished);
            // The operation doesn't keep its delegate: it is leaked, one small object per export.
            let kept = Retained::into_raw(delegate);
            let _: () = msg_send![
                &*operation,
                runOperationModalForWindow: &*window,
                delegate: kept,
                didRunSelector: sel!(printOperationDidRun:success:contextInfo:),
                contextInfo: std::ptr::null_mut::<c_void>()
            ];
            Ok(())
        }
    }
}
