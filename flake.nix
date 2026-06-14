{
  description = "Ostium Webhook Trader - Deno/Fresh dev environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forEachSystem = nixpkgs.lib.genAttrs systems;
      pkgsFor = forEachSystem (system: import nixpkgs { inherit system; });
    in
    {
      devShells = forEachSystem (
        system:
        let
          pkgs = pkgsFor.${system};
        in
        {
          default = pkgs.mkShell {
            # deno >= 2.8 is required for the built-in node:sqlite module.
            packages = [
              pkgs.git
              pkgs.deno
              pkgs.sqlite # `sqlite3` CLI for inspecting ./data/app.db
              pkgs.openssl # generate SESSION_SECRET / SECRET_ENC_KEY
              pkgs.git
              pkgs.jq
            ];
            shellHook = ''
              echo "Ostium Webhook Trader - dev shell ($(deno --version | head -n1))"
              echo
              echo "  cp .env.example .env   # fill DELEGATE_PRIVATE_KEY; gen secrets:"
              echo "    openssl rand -hex 32   (SESSION_SECRET and SECRET_ENC_KEY)"
              echo "  deno install           # populate node_modules for Vite"
              echo "  deno task dev          # http://localhost:5173 (HMR)"
              echo "  deno task test         # run the test suite"
              echo
              echo "  or via nix:  nix run .#dev   |   nix run .#serve   |   nix run .#build"
            '';
          };
        }
      );

      # `nix run` convenience wrappers so the app runs locally through nix.
      # Each ensures node_modules is present, then runs the matching deno task.
      apps = forEachSystem (
        system:
        let
          pkgs = pkgsFor.${system};
          mkApp = name: text: {
            type = "app";
            program = "${
              pkgs.writeShellApplication {
                inherit name;
                runtimeInputs = [ pkgs.deno ];
                inherit text;
              }
            }/bin/${name}";
          };
        in
        {
          # Vite dev server with HMR (default).
          default = self.apps.${system}.dev;
          dev = mkApp "owt-dev" ''
            deno install --allow-scripts
            exec deno task dev "$@"
          '';
          # Production build + serve the optimized output.
          serve = mkApp "owt-serve" ''
            deno install --allow-scripts
            deno task build
            exec deno serve -A --port "''${PORT:-8000}" _fresh/server.js
          '';
          # Just produce the _fresh/ build output.
          build = mkApp "owt-build" ''
            deno install --allow-scripts
            exec deno task build
          '';
        }
      );
    };
}
