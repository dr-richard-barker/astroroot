"""Export RootNav 2.0 Arabidopsis hourglass model to ONNX for AstroRoot (browser)."""
import torch, torch.nn as nn
from hourglass import hg
from utils import convert_state_dict

WEIGHTS = "arabidopsis_plate.pth"
OUT = "arabidopsis.onnx"
IN_SIZE = 1024          # arabidopsis_plate.json: input-size

# 1. build + load
model = hg()            # HourglassNet(num_classes=6)
ckpt = torch.load(WEIGHTS, map_location="cpu", weights_only=False)
model.load_state_dict(convert_state_dict(ckpt["model_state"]))
model.eval()

# 2. forward() returns a list (one tensor per hourglass stack) -> take the last for a clean ONNX output
class Wrap(nn.Module):
    def __init__(self, m): super().__init__(); self.m = m
    def forward(self, x):
        o = self.m(x)
        return o[-1] if isinstance(o, (list, tuple)) else o

wrapped = Wrap(model).eval()

# 3. sanity check the shapes on CPU before exporting
dummy = torch.randn(1, 3, IN_SIZE, IN_SIZE)
with torch.no_grad():
    y = wrapped(dummy)
print("torch output shape:", tuple(y.shape))     # expect (1, 6, 512, 512)

# 4. export
torch.onnx.export(
    wrapped, dummy, OUT,
    input_names=["image"], output_names=["seg_heatmaps"],
    opset_version=17,
    dynamic_axes={"image": {0: "batch"}, "seg_heatmaps": {0: "batch"}},
)
print("wrote", OUT)
