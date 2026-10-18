import math
import unittest

from train_ai import scores


class M5EvaluationTests(unittest.TestCase):
    def test_error_metrics_include_zero_sales_except_for_mape(self):
        result = scores(actual=[10, 0], predicted=[8, 4])
        self.assertEqual(result["mae"], 3.0)
        self.assertEqual(result["rmse"], round(math.sqrt(10), 4))
        self.assertEqual(result["mape"], 20.0)


if __name__ == "__main__":
    unittest.main()
