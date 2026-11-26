{
  description = "NixOS development and desktop testing for Russian Roulette Revamped";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/2786a2a72088ecf32aea5b3ec52099e6a7cff78f";

  outputs = { nixpkgs, ... }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs { inherit system; };
      graphics = with pkgs; [
        fontconfig freetype libglvnd libx11 libxcb libxkbcommon vulkan-loader wayland
      ];
    in
    {
      devShells.${system}.default = pkgs.mkShell {
        packages = with pkgs; [
          cargo rustc rustfmt lld wasm-bindgen-cli nodejs_22 pkg-config python3 shellcheck xdg-utils
        ];
        buildInputs = graphics;
        ROULETTE_NIX_RUNTIME = pkgs.lib.makeLibraryPath graphics;
      };
    };
}
