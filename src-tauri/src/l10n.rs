//! Language of messages the UI shows: German until the frontend reports English (set_lang, at startup from
//! src/lib/i18n.ts). `tr!("de {x}", "en {x}")` formats the one for the current language.

use std::sync::atomic::{AtomicBool, Ordering};

static EN: AtomicBool = AtomicBool::new(false);

pub fn en() -> bool {
    EN.load(Ordering::Relaxed)
}

#[tauri::command]
pub fn set_lang(app: tauri::AppHandle, lang: String) {
    EN.store(lang == "en", Ordering::Relaxed);
    crate::relabel_menus(&app);
}

/// German or English text, formatted like format! (inline captures included).
#[macro_export]
macro_rules! tr {
    ($de:literal, $en:literal $(, $arg:expr)* $(,)?) => {
        if $crate::l10n::en() { format!($en $(, $arg)*) } else { format!($de $(, $arg)*) }
    };
}

#[cfg(test)]
mod tests {
    // German only: switching the global here would race with other tests that check German messages.
    #[test]
    fn tr_formatiert_deutsch() {
        let n = 3;
        assert_eq!(tr!("{n} Dateien", "{n} files"), "3 Dateien");
        assert_eq!(tr!("{} von {}", "{} of {}", 1, 2), "1 von 2");
    }
}
