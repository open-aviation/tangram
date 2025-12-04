use std::fs::{copy, create_dir_all, read_dir, remove_dir_all};
use std::path::Path;

fn main() {
    // Only change the linker arguments for macOS
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rustc-link-arg=-undefined");
        println!("cargo:rustc-link-arg=dynamic_lookup");
    }

    let src = Path::new("../dist-frontend");
    let dst = Path::new("../src/tangram_ship162/dist-frontend");

    /*
    // Debug the path with the following commands
    println!(
        "cargo:warning=Source path (absolute): {:?}",
        src.canonicalize().unwrap_or_else(|_| src.to_path_buf())
    );
    println!(
        "cargo:warning=Destination path (absolute): {:?}",
        dst.canonicalize()
            .unwrap_or_else(|_| std::env::current_dir().unwrap().join(dst))
    );*/

    if src.exists() {
        // Remove the destination directory if it exists
        let _ = remove_dir_all(dst);
        // Create the destination directory
        let _ = create_dir_all(dst);
        // Copy files from src to dst
        for entry in read_dir(src).unwrap() {
            let entry = entry.unwrap();
            let dst_path = dst.join(entry.file_name());
            copy(entry.path(), &dst_path).unwrap();
        }
    }
}
