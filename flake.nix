{
  description = "Tangram project";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  inputs.flake-utils.url = "github:numtide/flake-utils";
  inputs.poetry2nix = {
    url = "github:nix-community/poetry2nix";
    inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs = inputs @ { self, nixpkgs, flake-utils, poetry2nix }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        poetry2nix = inputs.poetry2nix.lib.mkPoetry2Nix { inherit pkgs; };
      in
      {
        packages = {
          tg = poetry2nix.mkPoetryApplication {
            projectDir = ./.;
            preferWheels = false; # set this to true to use premade wheels rather than the source
            overrides = poetry2nix.defaultPoetryOverrides.extend
              (final: prev: {
                broadcaster = prev.broadcaster.overridePythonAttrs
                (
                  old: {
                    buildInputs = (old.buildInputs or [ ]) ++ [ prev.setuptools ];
                  }
                );
              });
          };
          default = self.packages.${system}.tg;
        };

        # nix develop
        devShells.default = pkgs.mkShell {
          inputsFrom = [ self.packages.${system}.tg ];
          package = with pkgs; [
            ruff
            pyright
          ];
        };

        # nix develop .#poetry
        # Use this shell for changes to pyproject.toml and poetry.lock.
        devShells.poetry = pkgs.mkShell {
          packages = [ pkgs.poetry ];
        };
    });
}
