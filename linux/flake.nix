{
  description = "Local Studio for Linux: GTK4 + libadwaita development shell";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    rust-overlay = {
      url = "github:oxalica/rust-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      nixpkgs,
      rust-overlay,
      ...
    }:
    let
      inherit (nixpkgs) lib;
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      forAllSystems =
        f:
        lib.genAttrs systems (
          system:
          f (
            import nixpkgs {
              inherit system;
              overlays = [ rust-overlay.overlays.default ];
            }
          )
        );
    in
    {
      devShells = forAllSystems (
        pkgs:
        let
          rust = pkgs.rust-bin.stable."1.98.1".minimal.override {
            extensions = [
              "rustfmt"
              "clippy"
            ];
          };
          fonts = pkgs.makeFontsConf {
            fontDirectories = [
              pkgs.adwaita-fonts
              pkgs.cantarell-fonts
              pkgs.dejavu_fonts
              pkgs.noto-fonts-color-emoji
            ];
          };
          schemas = [
            pkgs.gtk4
            pkgs.gsettings-desktop-schemas
          ];
        in
        {
          default = pkgs.mkShell {
            packages = [
              rust
              pkgs.pkg-config
              pkgs.clang
              pkgs.git
              pkgs.xvfb-run
              pkgs.xorg.xvfb
              pkgs.dbus
              pkgs.rsync
            ];
            buildInputs = [
              pkgs.gtk4
              pkgs.libadwaita
              pkgs.glib
              pkgs.vte-gtk4
              pkgs.adwaita-icon-theme
              pkgs.hicolor-icon-theme
              pkgs.gsettings-desktop-schemas
            ];
            env.FONTCONFIG_FILE = "${fonts}";
            shellHook = ''
              export XDG_DATA_DIRS="${
                lib.concatMapStringsSep ":" (pkg: "${pkg}/share/gsettings-schemas/${pkg.name}") schemas
              }:${pkgs.adwaita-icon-theme}/share:${pkgs.hicolor-icon-theme}/share''${XDG_DATA_DIRS:+:$XDG_DATA_DIRS}"
            '';
          };
        }
      );
    };
}
