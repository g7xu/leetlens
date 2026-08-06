# automatically switch problem


# go from t,
# 2 * 0 = 0
# can we achieve 0 

class Solution:
    def smallestNumber(self, n: int, t: int) -> int:
        def digit_product(n):
            if n == 0:
                return 0
                
            res = 1
            while n != 0:
                res *= n % 10
                if res == 0:
                    return 0

                n = n // 10

            return res


        while digit_product(n) % t != 0:
            n += 1

        return n
