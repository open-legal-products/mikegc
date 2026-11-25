"""Write the film's contract with the intake film's OOXML generator.

    python3 make_docx.py docx/Harbor_Pine_MSA.docx msa-original   # Harbor & Pine's draft
    python3 make_docx.py docx/Harbor_Pine_MSA_markup.docx msa     # with Contract Markup's tracked changes
"""
import runpy
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import contracts  # noqa: E402  this film's contracts, in place of the intake film's

sys.modules["contracts"] = contracts
runpy.run_path(str(HERE.parent.parent / "intake-launch-film" / "capture" / "make_docx.py"), run_name="__main__")
