# Installation

```sh
# If need be...
mkdir -p ~/.config/systemd/user
# Copy the files to systemd configuration folder
cp systemd/* ~/.config/systemd/user/
```

# Prepare

```sh
systemctl --user enable decoder@delft
systemctl --user enable aggregator
systemctl --user enable turbulence  # should be tangram in the end
# etc.
```


# Run

```sh
systemctl --user start decoder@delft
systemctl --user start aggregator
systemctl --user start turbulence  # should be tangram in the end
# etc.
```

# Check what happens

```sh
systemctl --user status decoder@delft
systemctl --user status aggregator
systemctl --user status turbulence
# etc.
```
