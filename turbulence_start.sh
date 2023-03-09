systemctl --user restart decoder@delft
systemctl --user restart decoder@toulouse
systemctl --user restart decoder@palaiseau
systemctl --user restart decoder@salon
systemctl --user restart decoder@zurich
systemctl --user restart aggregator
systemctl --user restart turbulence

systemctl --user status decoder@zurich
systemctl --user status decoder@delft

systemctl --user status aggregator


systemctl --user stop decoder@delft
systemctl --user stop decoder@toulouse
systemctl --user stop decoder@palaiseau
systemctl --user stop decoder@salon
systemctl --user stop decoder@zurich
systemctl --user stop aggregator

